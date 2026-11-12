import { View, Text } from 'react-native';
import { COLORS, S } from '../lib/ui';

/**
 * The breadcrumb trail, plotted without a map SDK.
 *
 * A native map on React Native means either an API key and a billing
 * account (Google) or a native module that breaks Expo Go — and the
 * whole point of the guardian app is that a parent can install it in
 * thirty seconds. So the trail is plotted directly: coordinates
 * normalised into the view, oldest faint, newest bright and pulsing.
 *
 * It is not a street map. It does show, unmistakably and in real time,
 * that she is moving and which way — which is what a frightened parent
 * is actually looking for. The street map lives in the control room,
 * where there is a desktop browser to run it.
 */
export default function TrailMap({ points, tint = COLORS.rose, height = 190 }) {
  if (!points || points.length === 0) {
    return (
      <View
        style={{
          height,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: COLORS.border,
          backgroundColor: COLORS.bgDeep,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={S.small}>Waiting for the first location…</Text>
      </View>
    );
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // A floor on the span stops a stationary person from filling the frame
  // with GPS jitter and looking like she is running around a field.
  const spanLat = Math.max(maxLat - minLat, 0.0008);
  const spanLng = Math.max(maxLng - minLng, 0.0008);
  const pad = 0.12;

  const norm = (p) => ({
    left: `${(pad + (1 - 2 * pad) * ((p.lng - minLng) / spanLng)) * 100}%`,
    // Screen Y grows downward; latitude grows northward. Flip it.
    top: `${(pad + (1 - 2 * pad) * (1 - (p.lat - minLat) / spanLat)) * 100}%`,
  });

  const last = points[points.length - 1];

  return (
    <View
      style={{
        height,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: tint,
        backgroundColor: COLORS.bgDeep,
        overflow: 'hidden',
      }}
    >
      {points.map((p, i) => {
        const age = i / Math.max(1, points.length - 1);
        const isLast = i === points.length - 1;
        const pos = norm(p);
        return (
          <View
            key={p.id ?? i}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              width: isLast ? 14 : 6,
              height: isLast ? 14 : 6,
              borderRadius: 999,
              marginLeft: isLast ? -7 : -3,
              marginTop: isLast ? -7 : -3,
              backgroundColor: isLast ? COLORS.text : tint,
              borderWidth: isLast ? 3 : 0,
              borderColor: tint,
              opacity: isLast ? 1 : 0.25 + age * 0.65,
            }}
          />
        );
      })}

      <View style={{ position: 'absolute', left: 10, bottom: 8 }}>
        <Text style={[S.small, { color: COLORS.textMuted }]}>
          {points.length} points · {last.lat.toFixed(5)}, {last.lng.toFixed(5)}
        </Text>
      </View>
    </View>
  );
}
