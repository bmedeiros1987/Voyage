const POI_TYPES = new Set(['GATE', 'BAGGAGE_CLAIM', 'SECURITY', 'IMMIGRATION', 'CUSTOMS', 'CHECK_IN', 'BAG_DROP', 'LOUNGE', 'RESTROOM', 'FOOD', 'GROUND_TRANSPORT', 'TERMINAL_EXIT', 'TRAIN', 'BUS', 'PARKING', 'OTHER']);
const EDGE_TYPES = new Set(['WALK', 'ESCALATOR', 'ELEVATOR', 'STAIRS', 'MOVING_WALKWAY', 'TRAIN', 'SHUTTLE']);

export function airportIndoorNavigationCapabilities() {
  return {
    version: '1.0',
    rendering: 'IN_APP',
    externalAppRequired: false,
    supportedTargets: [...POI_TYPES],
    supportedEdges: [...EDGE_TYPES],
    providerStrategy: [
      'Use airport-official indoor data when licensed and available.',
      'Use Mapbox/compatible indoor floor plans as a rendering layer when coverage exists.',
      'Maintain a Voyage routing graph for gates, baggage claims, security, immigration, customs, exits and inter-terminal links.',
      'Never invent an indoor path when floor/graph data are missing.'
    ],
    offline: {
      graphCacheSupported: true,
      mapTileCacheDependsOnProviderLicense: true,
      liveOperationalDataStillRequiresConnectivity: true
    },
    positioning: {
      gpsIndoorsMayBeWeak: true,
      supportedInputs: ['LAST_KNOWN_GATE', 'USER_SELECTED_POSITION', 'GPS_WHEN_AVAILABLE', 'BLE_OR_WIFI_WHEN_AIRPORT_SUPPORTS_IT', 'PHONE_SENSORS'],
      routeCanWorkWithoutPreciseIndoorPosition: true
    }
  };
}

export function buildAirportIndoorRoute(input = {}) {
  const airport = safeToken(input.airport);
  const graph = normalizeGraph(input.graph || {});
  const origin = safeString(input.originId || input.origin?.id, 160);
  const destination = safeString(input.destinationId || input.destination?.id, 160);
  const preferences = {
    accessibilityRequired: input.accessibilityRequired === true,
    avoidStairs: input.avoidStairs === true || input.accessibilityRequired === true,
    preferMovingWalkways: input.preferMovingWalkways !== false
  };

  if (!airport || !origin || !destination) {
    return {
      status: 'NEEDS_INPUT',
      airport,
      route: null,
      missing: [!airport && 'AIRPORT', !origin && 'ORIGIN', !destination && 'DESTINATION'].filter(Boolean),
      externalAppRequired: false
    };
  }

  if (!graph.nodes.has(origin) || !graph.nodes.has(destination)) {
    return {
      status: 'NEEDS_INDOOR_MAP_DATA',
      airport,
      route: null,
      missing: [!graph.nodes.has(origin) && 'ORIGIN_POI', !graph.nodes.has(destination) && 'DESTINATION_POI'].filter(Boolean),
      externalAppRequired: false,
      fallback: buildTerminalFallback(input)
    };
  }

  const result = shortestPath(graph, origin, destination, preferences);
  if (!result) {
    return {
      status: 'NO_ACCESSIBLE_PATH',
      airport,
      route: null,
      externalAppRequired: false,
      fallback: buildTerminalFallback(input)
    };
  }

  return {
    status: 'ROUTE_READY',
    airport,
    externalAppRequired: false,
    route: {
      origin: graph.nodes.get(origin),
      destination: graph.nodes.get(destination),
      totalMeters: Math.round(result.totalMeters),
      estimatedMinutes: Math.max(1, Math.ceil(result.totalSeconds / 60)),
      floorChanges: result.edges.filter((edge) => edge.fromFloor !== edge.toFloor).length,
      steps: result.edges.map((edge, index) => buildStep(edge, graph, index + 1)),
      polylineNodeIds: result.nodeIds
    },
    ui: {
      renderInsideVoyage: true,
      showFloorSelector: true,
      showLiveFlightOverlay: true,
      showBaggageCarouselOverlay: true,
      showGateOverlay: true,
      allowUserToRecenter: true
    },
    freshness: {
      mapGraphUpdatedAt: graph.updatedAt,
      operationalOverlaysRequireFreshData: true
    }
  };
}

function shortestPath(graph, origin, destination, preferences) {
  const distances = new Map([[origin, 0]]);
  const previous = new Map();
  const queue = new Set(graph.nodes.keys());

  while (queue.size) {
    let current = null;
    let best = Infinity;
    for (const node of queue) {
      const value = distances.get(node) ?? Infinity;
      if (value < best) {
        best = value;
        current = node;
      }
    }
    if (current === null || best === Infinity) break;
    queue.delete(current);
    if (current === destination) break;

    const edges = graph.adjacency.get(current) || [];
    for (const edge of edges) {
      if (!queue.has(edge.to)) continue;
      if (preferences.accessibilityRequired && edge.accessible === false) continue;
      if (preferences.avoidStairs && edge.type === 'STAIRS') continue;
      const penalty = edgePenalty(edge, preferences);
      const candidate = best + edge.seconds + penalty;
      if (candidate < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, candidate);
        previous.set(edge.to, { from: current, edge });
      }
    }
  }

  if (!distances.has(destination)) return null;
  const edges = [];
  const nodeIds = [destination];
  let cursor = destination;
  while (cursor !== origin) {
    const entry = previous.get(cursor);
    if (!entry) return null;
    edges.push(entry.edge);
    cursor = entry.from;
    nodeIds.push(cursor);
  }
  edges.reverse();
  nodeIds.reverse();
  return {
    edges,
    nodeIds,
    totalSeconds: edges.reduce((sum, edge) => sum + edge.seconds, 0),
    totalMeters: edges.reduce((sum, edge) => sum + edge.meters, 0)
  };
}

function edgePenalty(edge, preferences) {
  let penalty = 0;
  if (preferences.preferMovingWalkways && edge.type === 'MOVING_WALKWAY') penalty -= Math.min(20, edge.seconds * 0.1);
  if (edge.type === 'STAIRS') penalty += 30;
  if (edge.type === 'SHUTTLE' || edge.type === 'TRAIN') penalty += 45;
  return penalty;
}

function buildStep(edge, graph, order) {
  const from = graph.nodes.get(edge.from);
  const to = graph.nodes.get(edge.to);
  const action = edge.type === 'ELEVATOR'
    ? `Pegue o elevador${to?.floor ? ` para ${to.floor}` : ''}`
    : edge.type === 'ESCALATOR'
      ? `Use a escada rolante${to?.floor ? ` para ${to.floor}` : ''}`
      : edge.type === 'STAIRS'
        ? `Use as escadas${to?.floor ? ` para ${to.floor}` : ''}`
        : edge.type === 'TRAIN'
          ? 'Pegue o trem interno'
          : edge.type === 'SHUTTLE'
            ? 'Pegue o shuttle interno'
            : edge.type === 'MOVING_WALKWAY'
              ? 'Siga pela esteira rolante'
              : 'Siga pelo terminal';
  return {
    order,
    action,
    from: from?.label || edge.from,
    to: to?.label || edge.to,
    meters: Math.round(edge.meters),
    estimatedMinutes: Math.max(1, Math.ceil(edge.seconds / 60)),
    fromFloor: edge.fromFloor,
    toFloor: edge.toFloor,
    accessible: edge.accessible
  };
}

function normalizeGraph(input) {
  const nodes = new Map();
  const adjacency = new Map();
  const nodeList = Array.isArray(input.nodes) ? input.nodes.slice(0, 5000) : [];
  for (const item of nodeList) {
    const id = safeString(item.id, 160);
    if (!id) continue;
    nodes.set(id, {
      id,
      label: safeString(item.label || item.name, 220) || id,
      poiType: POI_TYPES.has(safeToken(item.poiType || item.type)) ? safeToken(item.poiType || item.type) : 'OTHER',
      floor: safeString(item.floor, 80),
      terminal: safeString(item.terminal, 80),
      latitude: optionalNumber(item.latitude, -90, 90),
      longitude: optionalNumber(item.longitude, -180, 180)
    });
    adjacency.set(id, []);
  }

  const edgeList = Array.isArray(input.edges) ? input.edges.slice(0, 15000) : [];
  for (const item of edgeList) {
    const from = safeString(item.from, 160);
    const to = safeString(item.to, 160);
    if (!nodes.has(from) || !nodes.has(to)) continue;
    const type = EDGE_TYPES.has(safeToken(item.type)) ? safeToken(item.type) : 'WALK';
    const meters = optionalNumber(item.meters, 0, 10000) ?? 0;
    const seconds = optionalNumber(item.seconds ?? item.durationSeconds, 1, 7200) ?? Math.max(10, meters / 1.25);
    const edge = {
      from,
      to,
      type,
      meters,
      seconds,
      accessible: item.accessible === false ? false : true,
      fromFloor: nodes.get(from)?.floor || null,
      toFloor: nodes.get(to)?.floor || null
    };
    adjacency.get(from).push(edge);
    if (item.oneWay !== true) adjacency.get(to).push({ ...edge, from: to, to: from, fromFloor: edge.toFloor, toFloor: edge.fromFloor });
  }

  return {
    nodes,
    adjacency,
    updatedAt: safeDateTime(input.updatedAt),
    provider: safeString(input.provider, 120)
  };
}

function buildTerminalFallback(input) {
  return {
    type: 'IN_APP_TERMINAL_GUIDANCE',
    terminal: safeString(input.terminal, 80),
    instruction: 'Mostrar orientação por terminal/andar e placas conhecidas dentro do Voyage até que o grafo indoor completo esteja disponível.',
    opensExternalMapApp: false
  };
}

function safeString(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function safeToken(value) {
  const text = safeString(value, 100);
  return text ? text.toUpperCase().replace(/[^A-Z0-9_-]+/g, '_') : null;
}

function optionalNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function safeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
