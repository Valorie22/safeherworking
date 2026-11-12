import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, S, statusTone } from '../lib/ui';
import {
  TABLES,
  formatDateTime,
  formatDistance,
  statusLabel,
  triggerLabel,
} from '@safeher/shared';

export default function History({ session }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    supabase
      .from(TABLES.incidents)
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setRows(data ?? []));
  }, [session.user.id]);

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 22, paddingBottom: 60 }}>
      <Text style={S.h1}>History</Text>
      <Text style={[S.body, { marginTop: 6 }]}>Every alert you have ever raised.</Text>

      <View style={{ gap: 10, marginTop: 20 }}>
        {rows.map((r) => {
          const medical = r.type === 'medical';
          return (
            <View
              key={r.id}
              style={[S.card, { borderColor: medical ? COLORS.amber : COLORS.border }]}
            >
              <View style={[S.row, { justifyContent: 'space-between' }]}>
                <Text
                  style={{
                    color: medical ? COLORS.amber : COLORS.rose,
                    fontWeight: '900',
                    fontSize: 11,
                    letterSpacing: 1.4,
                  }}
                >
                  {medical ? 'MEDICAL' : 'SAFETY'}
                </Text>
                <Text style={[S.pillText, { color: statusTone(r.status) }]}>
                  {statusLabel(r.status)}
                </Text>
              </View>

              <Text style={[S.h2, { marginTop: 4 }]}>{r.public_ref}</Text>
              <Text style={S.body}>{triggerLabel(r.trigger_reason)}</Text>
              <Text style={S.small}>
                {formatDateTime(r.created_at)}
                {r.routing_distance_m
                  ? ' · routed ' + formatDistance(r.routing_distance_m)
                  : ''}
              </Text>

              {r.resolution_note ? (
                <Text style={[S.small, { marginTop: 6, color: COLORS.textMuted }]}>
                  {r.resolution_note}
                </Text>
              ) : null}
            </View>
          );
        })}
        {rows.length === 0 && (
          <Text style={S.small}>No alerts. Long may it stay that way.</Text>
        )}
      </View>
    </ScrollView>
  );
}
