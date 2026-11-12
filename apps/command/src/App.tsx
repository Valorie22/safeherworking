import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { isMedicalRole, supabase, useResponder } from './lib/supabase';
import { useIncidents } from './lib/useIncidents';
import { useIncidentDetail } from './lib/useIncidentDetail';
import { playAlertTone } from './lib/audio';
import { TABLES } from '@safeher/shared';
import type { Hospital, PoliceStation, Responder } from '@safeher/shared';
import Login from './components/Login';
import TopBar from './components/TopBar';
import IncidentQueue from './components/IncidentQueue';
import MapPane from './components/MapPane';
import DetailPane from './components/DetailPane';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Gate medical={false} />} />
        <Route path="/med" element={<Gate medical={true} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Auth + role routing. A medic who lands on / is sent to /med, and back. */
function Gate({ medical }: { medical: boolean }) {
  const { loading, responder, email } = useResponder();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !responder) return;
    if (isMedicalRole(responder) && !medical) navigate('/med', { replace: true });
    if (!isMedicalRole(responder) && medical) navigate('/', { replace: true });
  }, [loading, responder, medical, navigate]);

  if (loading) {
    return (
      <div className="h-full grid place-items-center text-sh-faint text-sm">
        Connecting to SafeHer…
      </div>
    );
  }

  if (!responder) {
    // Signed in but with no responder row: an account that exists in auth
    // but was never given a role. Say so plainly rather than showing an
    // empty control room.
    if (email) {
      return (
        <div className="h-full grid place-items-center p-8 text-center">
          <div>
            <p className="text-sh-critical font-semibold">
              {email} is not a responder account.
            </p>
            <p className="text-sh-muted text-sm mt-1">
              Control-room access needs a row in <code className="text-sh-lilac">responders</code>.
            </p>
            <button
              onClick={() => supabase.auth.signOut()}
              className="mt-4 text-xs border border-sh-border rounded-md px-3 py-1.5 hover:border-sh-rose/60"
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }
    return <Login />;
  }

  return <ControlRoom responder={responder} medical={medical} />;
}

function ControlRoom({ responder, medical }: { responder: Responder; medical: boolean }) {
  const { incidents, conn, lastSync } = useIncidents({ responder, medical });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState('—');
  const announced = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const selected = useMemo(
    () => incidents.find((i) => i.id === selectedId) ?? null,
    [incidents, selectedId],
  );

  const detail = useIncidentDetail(selectedId, {
    userId: selected?.user_id,
    stationId: selected?.assigned_station_id,
    hospitalId: selected?.assigned_hospital_id,
    unitId: selected?.assigned_unit_id,
    responderId: selected?.assigned_responder_id,
  });

  // The map wants the selected incident's related rows too.
  const selectedWithRelations = useMemo(
    () =>
      selected
        ? { ...selected, station: detail.station, hospital: detail.hospital, unit: detail.unit }
        : null,
    [selected, detail.station, detail.hospital, detail.unit],
  );

  // Which station or hospital am I?
  useEffect(() => {
    (async () => {
      if (responder.station_id) {
        const { data } = await supabase
          .from(TABLES.policeStations)
          .select('*')
          .eq('id', responder.station_id)
          .maybeSingle();
        setPlaceName((data as PoliceStation)?.name ?? 'Unknown station');
      } else if (responder.hospital_id) {
        const { data } = await supabase
          .from(TABLES.hospitals)
          .select('*')
          .eq('id', responder.hospital_id)
          .maybeSingle();
        setPlaceName((data as Hospital)?.name ?? 'Unknown hospital');
      } else {
        setPlaceName(responder.role === 'supervisor' ? 'City-wide control' : '—');
      }
    })();
  }, [responder]);

  // Alert tone on a genuinely new incident. The first render is skipped
  // so signing in does not fire a tone for everything already open.
  useEffect(() => {
    const fresh = incidents.filter((i) => i.status === 'new' && !announced.current.has(i.id));
    if (firstLoad.current) {
      incidents.forEach((i) => announced.current.add(i.id));
      if (incidents.length || conn === 'live') firstLoad.current = false;
      return;
    }
    if (fresh.length === 0) return;
    fresh.forEach((i) => announced.current.add(i.id));
    playAlertTone(fresh[0].type);
    // Auto-select the newest if the operator is not already reading one.
    if (!selectedId) setSelectedId(fresh[0].id);
  }, [incidents, conn, selectedId]);

  return (
    <div className="h-full flex flex-col">
      <TopBar
        responder={responder}
        placeName={placeName}
        incidents={incidents}
        conn={conn}
        medical={medical}
      />

      {conn === 'dropped' && (
        <div className="bg-sh-critical text-[#2A0410] px-4 py-2 text-sm font-bold flex items-center gap-3">
          <span className="blink">●</span>
          REALTIME CONNECTION LOST — polling every 3 seconds. New alerts may be delayed.
          <span className="ml-auto tabular font-normal text-xs opacity-80">
            last sync {new Date(lastSync).toLocaleTimeString('en-GB', { hour12: false })}
          </span>
        </div>
      )}

      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: '20rem 1fr 25rem' }}>
        <IncidentQueue
          incidents={incidents}
          selectedId={selectedId}
          onSelect={setSelectedId}
          medical={medical}
        />
        <MapPane
          incidents={incidents}
          selected={selectedWithRelations}
          locations={detail.locations}
          onSelect={setSelectedId}
          medical={medical}
        />
        <DetailPane
          incident={selectedWithRelations}
          detail={detail}
          responder={responder}
          medical={medical}
        />
      </div>
    </div>
  );
}
