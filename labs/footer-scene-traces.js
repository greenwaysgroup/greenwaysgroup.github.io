/** Light travels along existing streets and connected architectural edges.
 * Routes and connected street circuits are prepared once for continuous playback.
 */
export function createLightRoutes(city) {
  // A building must join the connected city network, not an isolated access
  // path that traps its entire contour in a short, repeatedly retraced circuit.
  const streetSegments = city.segments.filter(s => s.building === "streets");
  const junctions = new Map();
  const key = p => p.map(v => v.toFixed(5)).join(",");
  for (const road of streetSegments)
    for (const p of [road.a, road.b]) {
      const id = key(p);
      if (!junctions.has(id)) junctions.set(id, []);
      junctions.get(id).push(road);
    }
  const visited = new Set();
  let roads = [], longest = 0;
  for (const seed of streetSegments) {
    if (visited.has(seed)) continue;
    const pending = [seed], component = [];
    let length = 0;
    visited.add(seed);
    while (pending.length) {
      const road = pending.pop();
      component.push(road);
      length += Math.hypot(...road.a.map((v, i) => v - road.b[i]));
      for (const p of [road.a, road.b])
        for (const next of junctions.get(key(p)))
          if (!visited.has(next)) {
            visited.add(next);
            pending.push(next);
          }
    }
    if (length > longest) {
      roads = component;
      longest = length;
    }
  }
  const selected = city.landmarks.map((building) => building.id);
  const routes = [];
  for (const building of selected) {
    const edges = city.segments.filter(
      (s) => s.building === building && s.detail === 0 && s.tone === 1,
    );
    const nodes = new Map();
    const node = (p) => {
      const key = city.indices.get(p);
      if (!nodes.has(key))
        nodes.set(key, { p, links: [], distance: Infinity, previous: null });
      return nodes.get(key);
    };
    edges.forEach(e=>{node(e.a);node(e.b);});
    // Split touching outline edges at their junctions, including stepped roofs.
    for (const e of edges) {
      const delta=e.b.map((v,i)=>v-e.a[i]);
      const squared=delta.reduce((sum,v)=>sum+v*v,0);
      const onEdge=[];
      for(const n of nodes.values()) {
        const t=n.p.reduce((sum,v,i)=>sum+(v-e.a[i])*delta[i],0)/squared;
        if(t < -1e-5 || t > 1.00001)continue;
        const gap=Math.hypot(...n.p.map((v,i)=>v-e.a[i]-t*delta[i]));
        if(gap<.005)onEdge.push({n,t});
      }
      onEdge.sort((a,b)=>a.t-b.t);
      for(let i=1;i<onEdge.length;i++) {
        const a=onEdge[i-1].n,b=onEdge[i].n;
        const length=Math.hypot(...a.p.map((v,j)=>v-b.p[j]));
        if(length<.001)continue;
        if(!a.links.some(link=>link.node===b)){
          a.links.push({node:b,length});b.links.push({node:a,length});
        }
      }
    }
    let start,
      road,
      junction,
      best = Infinity;
    for (const n of nodes.values()) {
      if (n.p[1] > 0.8) continue;
      for (const r of roads) {
        const dx = r.b[0] - r.a[0],
          dz = r.b[2] - r.a[2];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((n.p[0] - r.a[0]) * dx + (n.p[2] - r.a[2]) * dz) /
              (dx * dx + dz * dz || 1),
          ),
        );
        const p = [r.a[0] + dx * t, 0.025, r.a[2] + dz * t];
        const d = Math.hypot(n.p[0] - p[0], n.p[2] - p[2]);
        if (d < best) {
          best = d;
          start = n;
          road = r;
          junction = p;
        }
      }
    }
    if (!start || best > 12) continue;
    // Dijkstra on the small primary-contour graph; the shortest connected
    // route avoids fabricated diagonals through the building volume.
    start.distance = 0;
    const pending = new Set(nodes.values());
    while (pending.size) {
      let current;
      for (const n of pending)
        if (!current || n.distance < current.distance) current = n;
      if (!Number.isFinite(current.distance)) break;
      pending.delete(current);
      for (const link of current.links) {
        const next = current.distance + link.length;
        if (next < link.node.distance) {
          link.node.distance = next;
          link.node.previous = current;
        }
      }
    }
    const reachable = [...nodes.values()].filter((n) =>
      Number.isFinite(n.distance),
    );
    reachable.sort((a, b) => b.p[1] - a.p[1] || a.distance - b.distance);
    const top = reachable[0];
    if (!top || top.p[1] < 6) continue;
    const contour = [];
    for (let n = top; n; n = n.previous) contour.push(n.p);
    contour.reverse();
    // Continue around the connected roof rim when one exists, so the light
    // describes a volume rather than stopping at the top of one vertical edge.
    const rimVisited = new Set([top]);
    let rim = top,
      rimLength = 0;
    while (rimLength < 16) {
      const next = rim.links.find(
        (link) =>
          !rimVisited.has(link.node) &&
          Math.abs(link.node.p[1] - top.p[1]) < 0.15,
      );
      if (!next) break;
      contour.push(next.node.p);
      rimVisited.add(next.node);
      rimLength += next.length;
      rim = next.node;
    }
    // Descend along connected edges, preferring a different facade from the ascent.
    const ascentEdges = new Set();
    const edgeKey = (a, b) => [city.indices.get(a), city.indices.get(b)].sort((a,b)=>a-b).join(":");
    for (let i=1;i<contour.length;i++) ascentEdges.add(edgeKey(contour[i-1],contour[i]));
    const distance = new Map([[rim,0]]), previous = new Map();
    const remaining = new Set(nodes.values());
    let exit;
    while (remaining.size) {
      let current;
      for (const n of remaining)
        if (!current || (distance.get(n)??Infinity)<(distance.get(current)??Infinity)) current=n;
      if (!Number.isFinite(distance.get(current))) break;
      remaining.delete(current);
      if (current.p[1]<=0.8) { exit=current; break; }
      for (const link of current.links) {
        const cost=link.length*(ascentEdges.has(edgeKey(current.p,link.node.p))?12:1);
        const next=distance.get(current)+cost;
        if(next<(distance.get(link.node)??Infinity)) {
          distance.set(link.node,next); previous.set(link.node,current);
        }
      }
    }
    if (!exit) continue;
    const descent=[];
    for(let n=exit;n;n=previous.get(n)) descent.push(n.p);
    descent.reverse();
    const points = [junction,[start.p[0],0.025,start.p[2]],...contour,
      ...descent.slice(1),[exit.p[0],0.025,exit.p[2]],junction];
    const parts = [];
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        d = Math.hypot(...a.map((v, j) => v - b[j]));
      if (d < 0.000001) continue;
      parts.push({
        a,
        b,
        start: length,
        end: length + d,
        building: i < 3 || i >= points.length - 2 ? "streets" : building,
      });
      length += d;
    }
    routes.push({ building, parts, length, closed: true });
  }
  return routes;
}

/** Connected contour circuits: up a contour, back to street level, then
 * through mapped street segments to another building. No airborne links. */
export function createSignalCircuits(city, routes) {
  const nodes=new Map();
  const node=p=>{
    const key=p.map(v=>v.toFixed(5)).join(',');
    if(!nodes.has(key))nodes.set(key,{p,links:[],routes:[]});
    return nodes.get(key);
  };
  const roads=city.segments.filter(s=>s.building==='streets');
  const splits=roads.map(r=>[{p:r.a,t:0},{p:r.b,t:1}]);
  for(const route of routes) {
    const p=route.parts[0].a;let nearest=-1,best=Infinity,along=0;
    roads.forEach((r,i)=>{
      const dx=r.b[0]-r.a[0],dz=r.b[2]-r.a[2];
      const t=Math.max(0,Math.min(1,((p[0]-r.a[0])*dx+(p[2]-r.a[2])*dz)/(dx*dx+dz*dz||1)));
      const d=Math.hypot(p[0]-r.a[0]-t*dx,p[2]-r.a[2]-t*dz);
      if(d<best){best=d;nearest=i;along=t;}
    });
    if(nearest>=0 && best<.005){splits[nearest].push({p,t:along});node(p).routes.push(route);}
  }
  let edgeId=0;
  for(const points of splits) {
    points.sort((a,b)=>a.t-b.t);
    for(let i=1;i<points.length;i++){
      const a=node(points[i-1].p),b=node(points[i].p);
      if(a===b)continue;
      const id=edgeId++;
      a.links.push({node:b,id});b.links.push({node:a,id});
    }
  }
  const visitedEdges=new Set(),visitedBuildings=new Set(),circuits=[];
  // An edge-covering walk includes side streets and disconnected components.
  // Retracing dead ends is unavoidable; building contours always complete first.
  for(const start of nodes.values()) {
    if(start.links.every(e=>visitedEdges.has(e.id)))continue;
    const parts=[];let length=0;
    const add=(a,b,building)=>{
      const d=Math.hypot(...a.map((v,i)=>v-b[i]));if(d<1e-8)return;
      parts.push({a,b,building,start:length,end:length+d});length+=d;
    };
    const stack=[{node:start,index:0,entered:false}];
    while(stack.length){
      const frame=stack.at(-1);
      if(!frame.entered){
        frame.entered=true;
        for(const route of frame.node.routes)if(!visitedBuildings.has(route.building)){
          visitedBuildings.add(route.building);
          for(const p of route.parts)add(p.a,p.b,p.building);
        }
      }
      const edge=frame.node.links[frame.index++];
      if(!edge){
        stack.pop();
        if(stack.length)add(frame.node.p,stack.at(-1).node.p,'streets');
      }else if(!visitedEdges.has(edge.id)){
        visitedEdges.add(edge.id);add(frame.node.p,edge.node.p,'streets');
        stack.push({node:edge.node,index:0,entered:false});
      }
    }
    if(length)circuits.push({parts,length});
  }
  return circuits;
}
