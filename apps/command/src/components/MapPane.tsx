import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { supabase } from '../lib/supabase';
import { COLORS, DEMO_CENTER, TABLES, formatDistance } from '@safeher/shared';
import type {
  Hospital,
  IncidentLocation,
  IncidentWithProfile,
  PoliceStation,
  Unit,
} from '@safeher/shared';

interface Props {
  incidents: IncidentWithProfile[];
  selected: IncidentWithProfile | null;
  locations: IncidentLocation[];
  onSelect: (id: string) => void;
  medical: boolean;
}

/**
 * Free OpenStreetMap raster tiles. No API key, no billing account —
 * which matters, because a demo that dies when someone's Mapbox trial
 * lapses is not a demo.
 */
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  // Symbol layers need a glyph source or their labels silently vanish.
  // This one is free and keyless, like the tiles. If it is ever
  // unreachable the pins still draw — only the labels drop, and every
  // label here is also printed in the detail panel.
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

/** A circle on the ground, in metres — the labelled routing ring. */
function circlePolygon(lat: number, lng: number, radiusM: number, steps = 72): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const latR = radiusM / 111_320;
  const lngR = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    coords.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

export default function MapPane({ incidents, selected, locations, onSelect, medical }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const ready = useRef(false);
  const flownTo = useRef<Set<string>>(new Set());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // ---- init ----
  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = new maplibregl.Map({
      container: holder.current,
      style: STYLE,
      center: [DEMO_CENTER.lng, DEMO_CENTER.lat],
      zoom: DEMO_CENTER.zoom,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // MapLibre measures its container once, at construction. Inside a
    // flex/grid layout that height is often still 0 at that moment, and
    // the canvas gets stuck at the 300px HTML default — a map that is
    // there, listening, and invisible. trackResize only watches the
    // window, which never fires if the pane resizes without it, so watch
    // the container itself.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(holder.current!);
    resizeObserver.current = ro;
    requestAnimationFrame(() => m.resize());

    m.on('load', async () => {
      // --- infrastructure ---
      const [{ data: stations }, { data: hospitals }, { data: units }] = await Promise.all([
        supabase.from(TABLES.policeStations).select('*'),
        supabase.from(TABLES.hospitals).select('*'),
        supabase.from(TABLES.units).select('*'),
      ]);

      m.addSource('stations', {
        type: 'geojson',
        data: toPoints((stations ?? []) as PoliceStation[], (s) => ({
          name: s.name,
          code: s.code ?? '',
        })),
      });
      m.addSource('hospitals', {
        type: 'geojson',
        data: toPoints((hospitals ?? []) as Hospital[], (h) => ({
          name: h.name,
          trauma: h.has_trauma_unit ? 1 : 0,
        })),
      });
      m.addSource('units', {
        type: 'geojson',
        data: toPoints(
          ((units ?? []) as Unit[]).filter((u) => u.lat != null),
          (u) => ({ callsign: u.callsign, kind: u.kind ?? 'patrol', status: u.status }),
        ),
      });
      m.addSource('trail', { type: 'geojson', data: empty });
      m.addSource('trail-head', { type: 'geojson', data: empty });
      m.addSource('routing-line', { type: 'geojson', data: empty });
      m.addSource('routing-ring', { type: 'geojson', data: empty });
      m.addSource('incidents', { type: 'geojson', data: empty });

      // --- routing ring + line, drawn under everything else ---
      m.addLayer({
        id: 'routing-ring-fill',
        type: 'fill',
        source: 'routing-ring',
        paint: { 'fill-color': COLORS.lilac, 'fill-opacity': 0.06 },
      });
      m.addLayer({
        id: 'routing-ring-line',
        type: 'line',
        source: 'routing-ring',
        paint: {
          'line-color': COLORS.lilac,
          'line-width': 1.2,
          'line-dasharray': [3, 3],
          'line-opacity': 0.8,
        },
      });
      m.addLayer({
        id: 'routing-line',
        type: 'line',
        source: 'routing-line',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': COLORS.lilac, 'line-width': 2.5, 'line-opacity': 0.9 },
      });
      m.addLayer({
        id: 'routing-line-label',
        type: 'symbol',
        source: 'routing-line',
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-font': ['Open Sans Regular'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': COLORS.lilacSoft,
          'text-halo-color': COLORS.bgDeep,
          'text-halo-width': 2,
        },
      });

      // --- breadcrumb trail: the operator literally watches her move ---
      m.addLayer({
        id: 'trail-line',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': medical ? COLORS.amber : COLORS.rose,
          'line-width': 3,
          'line-opacity': 0.85,
        },
      });
      m.addLayer({
        id: 'trail-head',
        type: 'circle',
        source: 'trail-head',
        paint: {
          'circle-radius': 6,
          'circle-color': COLORS.text,
          'circle-stroke-width': 3,
          'circle-stroke-color': medical ? COLORS.amber : COLORS.rose,
        },
      });

      // --- stations as shields ---
      m.addLayer({
        id: 'stations',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': 7,
          'circle-color': COLORS.surfaceHi,
          'circle-stroke-width': 2,
          'circle-stroke-color': COLORS.sky,
          'circle-opacity': 0.95,
        },
      });
      m.addLayer({
        id: 'stations-label',
        type: 'symbol',
        source: 'stations',
        layout: {
          'text-field': ['get', 'code'],
          'text-size': 10,
          'text-offset': [0, 1.4],
          'text-font': ['Open Sans Regular'],
        },
        paint: {
          'text-color': COLORS.skySoft,
          'text-halo-color': COLORS.bgDeep,
          'text-halo-width': 1.5,
        },
      });

      // --- hospitals as crosses ---
      m.addLayer({
        id: 'hospitals',
        type: 'circle',
        source: 'hospitals',
        paint: {
          'circle-radius': 7,
          'circle-color': COLORS.surfaceHi,
          'circle-stroke-width': 2,
          'circle-stroke-color': COLORS.mint,
        },
      });
      m.addLayer({
        id: 'hospitals-label',
        type: 'symbol',
        source: 'hospitals',
        layout: {
          'text-field': ['case', ['==', ['get', 'trauma'], 1], '✚ TRAUMA', '✚'],
          'text-size': 10,
          'text-offset': [0, 1.4],
          'text-font': ['Open Sans Regular'],
        },
        paint: {
          'text-color': COLORS.mintSoft,
          'text-halo-color': COLORS.bgDeep,
          'text-halo-width': 1.5,
        },
      });

      // --- units ---
      m.addLayer({
        id: 'units',
        type: 'circle',
        source: 'units',
        paint: {
          'circle-radius': 5,
          'circle-color': [
            'match',
            ['get', 'status'],
            'available',
            COLORS.mint,
            'dispatched',
            COLORS.amber,
            'enroute',
            COLORS.amber,
            COLORS.grey,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': COLORS.bgDeep,
        },
      });
      m.addLayer({
        id: 'units-label',
        type: 'symbol',
        source: 'units',
        layout: {
          'text-field': ['get', 'callsign'],
          'text-size': 9,
          'text-offset': [0, -1.3],
          'text-font': ['Open Sans Regular'],
        },
        paint: {
          'text-color': COLORS.textMuted,
          'text-halo-color': COLORS.bgDeep,
          'text-halo-width': 1.5,
        },
      });

      // --- incidents, on top of everything ---
      m.addLayer({
        id: 'incidents-halo',
        type: 'circle',
        source: 'incidents',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'isnew'], 1], 20, 13],
          'circle-color': ['case', ['==', ['get', 'medical'], 1], COLORS.amber, COLORS.rose],
          'circle-opacity': 0.18,
        },
      });
      m.addLayer({
        id: 'incidents',
        type: 'circle',
        source: 'incidents',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 10, 7],
          'circle-color': ['case', ['==', ['get', 'medical'], 1], COLORS.amber, COLORS.rose],
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 2],
          'circle-stroke-color': COLORS.text,
        },
      });
      m.addLayer({
        id: 'incidents-label',
        type: 'symbol',
        source: 'incidents',
        layout: {
          'text-field': ['get', 'ref'],
          'text-size': 10,
          'text-offset': [0, -1.7],
          'text-font': ['Open Sans Regular'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': COLORS.text,
          'text-halo-color': COLORS.bgDeep,
          'text-halo-width': 2,
        },
      });

      m.on('click', 'incidents', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      for (const layer of ['incidents', 'stations', 'hospitals']) {
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
      }

      ready.current = true;
    });

    return () => {
      resizeObserver.current?.disconnect();
      resizeObserver.current = null;
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medical]);

  // ---- incident pins ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const src = m.getSource('incidents') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    src.setData({
      type: 'FeatureCollection',
      features: incidents
        .filter((i) => i.lat != null && i.lng != null)
        .map((i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [i.lng!, i.lat!] },
          properties: {
            id: i.id,
            ref: i.public_ref,
            medical: i.type === 'medical' ? 1 : 0,
            isnew: i.status === 'new' ? 1 : 0,
            selected: i.id === selected?.id ? 1 : 0,
          },
        })),
    });
  }, [incidents, selected?.id]);

  // ---- a brand new incident takes the map, with nobody touching it ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const fresh = incidents.find(
      (i) => i.status === 'new' && i.lat != null && !flownTo.current.has(i.id),
    );
    if (!fresh) return;
    flownTo.current.add(fresh.id);
    m.flyTo({
      center: [fresh.lng!, fresh.lat!],
      zoom: 15,
      speed: 1.5,
      curve: 1.5,
      essential: true,
    });
  }, [incidents]);

  // ---- selected incident: trail, routing line, routing ring ----
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;

    const trail = m.getSource('trail') as maplibregl.GeoJSONSource | undefined;
    const head = m.getSource('trail-head') as maplibregl.GeoJSONSource | undefined;
    const line = m.getSource('routing-line') as maplibregl.GeoJSONSource | undefined;
    const ring = m.getSource('routing-ring') as maplibregl.GeoJSONSource | undefined;
    if (!trail || !head || !line || !ring) return;

    if (!selected || selected.lat == null) {
      trail.setData(empty);
      head.setData(empty);
      line.setData(empty);
      ring.setData(empty);
      return;
    }

    // Start the trail at the trigger point, then follow the breadcrumbs.
    const pts: [number, number][] = [
      [selected.lng!, selected.lat!],
      ...locations.map((l) => [l.lng, l.lat] as [number, number]),
    ];

    trail.setData({
      type: 'FeatureCollection',
      features:
        pts.length > 1
          ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} }]
          : [],
    });

    const last = pts[pts.length - 1];
    head.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: last }, properties: {} }],
    });

    // The line to whichever surface owns this incident, labelled with the
    // distance routing actually used.
    const target =
      selected.type === 'medical' && selected.hospital
        ? selected.hospital
        : (selected.station ?? null);

    if (target) {
      line.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [selected.lng!, selected.lat!],
                [target.lng, target.lat],
              ],
            },
            properties: {
              label: `${target.name} · ${formatDistance(selected.routing_distance_m)}`,
            },
          },
        ],
      });
    } else {
      line.setData(empty);
    }

    ring.setData({
      type: 'FeatureCollection',
      features: selected.routing_distance_m
        ? [circlePolygon(selected.lat!, selected.lng!, selected.routing_distance_m)]
        : [],
    });
  }, [selected, locations]);

  return (
    <div className="relative h-full map-dark">
      {/* Positioned inline, not by a utility class: MapLibre's stylesheet
          also targets this element once it mounts, and an inline style is
          the one thing it cannot override. */}
      <div
        ref={holder}
        className="absolute inset-0"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <Legend medical={medical} />
    </div>
  );
}

function toPoints<T extends { lat: number | null; lng: number | null; id: string }>(
  rows: T[],
  props: (r: T) => Record<string, unknown>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [r.lng!, r.lat!] },
        properties: { id: r.id, ...props(r) },
      })),
  };
}

function Legend({ medical }: { medical: boolean }) {
  const items = [
    { c: COLORS.rose, l: 'Safety SOS' },
    { c: COLORS.amber, l: 'Medical SOS' },
    { c: COLORS.sky, l: 'Police station' },
    { c: COLORS.mint, l: 'Hospital / available unit' },
    { c: COLORS.lilac, l: 'Auto-routing' },
  ];
  return (
    <div
      className="absolute top-3 left-3 bg-sh-surface/90 backdrop-blur border border-sh-border
                 rounded-lg px-3 py-2 text-[11px] space-y-1 pointer-events-none"
    >
      <div className="text-[9px] uppercase tracking-[0.18em] text-sh-faint font-bold mb-1">
        {medical ? 'Medical wall' : 'City wall'}
      </div>
      {items.map((i) => (
        <div key={i.l} className="flex items-center gap-2 text-sh-muted">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: i.c }} />
          {i.l}
        </div>
      ))}
    </div>
  );
}
