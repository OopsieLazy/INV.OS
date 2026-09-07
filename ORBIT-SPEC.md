# ORBIT MODE — implementation handoff

## What this is
Adds an optional "living planetary motion" mode to the INV.OS graph. When ON (and the
graph is in the **galaxy** or **projects** view), the force-simulation is allowed to
settle, then each node switches to real orbital motion: a project's parts revolve around
that project's core, and the projects revolve around the central sun. Orbits are
**circular on individually-tilted 3D planes**, so through the existing perspective camera
they read as **ellipses** (real-planet feel) without the cost of true Kepler ellipses.

It is a **toggle**, defaulting OFF, because it repaints every frame (continuous motion).
Think of it as a "show mode."

## Prerequisites (already in your build — do not re-add)
This assumes your file already has the graph system with:
- `gNodes` (array of {id, type, x, y, z, cid?, core?, ...}) and `gEdges`
  (array of {a, b, w} where a/b are node objects; **w<0 marks a "trail" edge** between
  projects — these are skipped by orbits).
- Node `type` values include: `"sun"` (pinned center), `"proj"` (project core),
  `"part"`, `"dept"`, `"shared"`.
- A `gView` object with `.kind` in `"inv" | "projects" | "galaxy" | "proj"`.
- `gTick()` — the requestAnimationFrame physics/render loop — with a local `const a=gAlpha;`
  near the top, `gDraw()` near the end, `gAutoRot`, `gYaw`, `cfg("driftSpeed")`,
  `gPopped()`, `gWin`, `graphMode`, `gRAF`.
- `setGraphView(v)` — switches the graph view; has a `const changed = ...` line.
- The graph command has a subverb chain (…`else if ([...].includes(ml)){...}`…) where
  `ml` is the lowercased argument (e.g. handling `graph home`, `graph 3d`).

If your galaxy/projects builders differ, the only hard requirement is: **parts connect to
their project via a normal (w>=0) edge, and projects connect to a "sun" (or "dept") node
via a normal edge.** `orbitParentMap()` derives the orbit hierarchy from those edges.

## STEP 1 — add orbit state
Near the other graph-state flags (e.g. the line declaring `g3d, gStyle, gCores`), add:

```js
let gOrbit=false, gOrbitInit=false;  // ORBIT MOCK: living planetary motion
```

## STEP 2 — add the orbit engine + gTick branch
Paste the block below **immediately before** `function gTick(){`. It defines three
helpers, then shows the branch to insert **inside** gTick right after `const a=gAlpha;`.
(If you paste the whole thing before gTick, then move just the marked branch into gTick,
that's the cleanest.)

```js
function orbitParentMap(){
  const parent={};
  gEdges.forEach(e=>{
    if (e.w<0) return;
    const at=e.a.type, bt=e.b.type;
    if (bt==="sun"||bt==="dept") parent[e.a.id]=e.b.id;
    else if (at==="sun"||at==="dept") parent[e.b.id]=e.a.id;
    else if (at==="proj"&&bt!=="proj") parent[e.b.id]=e.a.id;
    else if (bt==="proj"&&at!=="proj") parent[e.a.id]=e.b.id;
  });
  return parent;
}
function initOrbits(){
  const parent=orbitParentMap(), byId={}; gNodes.forEach(n=>byId[n.id]=n);
  gNodes.forEach(n=>{
    const par=byId[parent[n.id]];
    if (!par || n.type==="sun"){ n.orb=null; return; }
    const dx=n.x-par.x, dy=n.y-par.y, dz=(n.z||0)-(par.z||0);
    const r=Math.max(12,Math.hypot(dx,dy,dz));
    const seed=(n.cid||n.id.length*7)+r;
    const incl=((Math.sin(seed)*0.5+0.5)*1.1);
    const speed=(0.15+0.5/Math.sqrt(r))*(seed%2?1:-1)*0.02;
    n.orb={ parent:par.id, r, incl, ang:Math.atan2(dy,dx), speed,
            cx:Math.cos(incl), sx:Math.sin(incl) };
  });
  gOrbitInit=true;
}
function stepOrbits(dt){
  const byId={}; gNodes.forEach(n=>byId[n.id]=n);
  gNodes.forEach(n=>{
    if (n.type==="sun"){ n.x=0;n.y=0;n.z=0; return; }
    const o=n.orb; if(!o) return;
    const par=byId[o.parent]; if(!par) return;
    o.ang += o.speed*dt;
    n.x=par.x+Math.cos(o.ang)*o.r;
    n.y=par.y+Math.sin(o.ang)*o.r*o.cx;
    n.z=(par.z||0)+Math.sin(o.ang)*o.r*o.sx;
  });
}

// --- inside gTick(), immediately after `const a=gAlpha;`, add this branch: ---
  if (gOrbit && (gView.kind==="galaxy"||gView.kind==="projects")){
    if (a<=0.05 && !gOrbitInit) initOrbits();
    if (gOrbitInit){ stepOrbits(1); gAlpha=0.001;
      if (g3d && gAutoRot) gYaw+=cfg("driftSpeed");
      gDraw();
      if (graphMode==="off" && !gPopped()){ gRAF=null; return; }
      gRAF = gPopped() ? gWin.requestAnimationFrame(gTick) : requestAnimationFrame(gTick);
      return;
    }
  }
```

### How the gTick branch must sit
Inside `gTick()`, the very first thing after `const a=gAlpha;` should be the
`if (gOrbit && (gView.kind==="galaxy"||gView.kind==="projects")){ ... }` block. It:
- waits until the layout has settled (`a<=0.05`) then calls `initOrbits()` once,
- each frame calls `stepOrbits(1)` and pins `gAlpha=0.001` (so the force sim stays quiet),
- still applies the gentle auto-rotate, draws, and re-schedules the frame,
- then `return`s so the normal force-sim code below does NOT run while orbiting.

## STEP 3 — add the toggle command
In the graph subverb chain (where `graph home`, `graph 3d`, etc. are handled), add:

```js
      if (["orbit","orbits","planets","spin"].includes(ml)){
        gOrbit=!gOrbit; gOrbitInit=false;
        if (gOrbit && gView.kind!=="galaxy" && gView.kind!=="projects") setGraphView({kind:"galaxy"});
        gAlpha=Math.max(gAlpha,0.6);
        print(`orbit mode ${gOrbit?"ON — parts revolve, projects wheel around the sun":"off"}`,"d");
        return;
      }
```

This makes `graph orbit` (aliases: orbits / planets / spin) flip the mode. When turning
it on outside galaxy/projects it switches to galaxy first, and re-heats the sim so it
settles then takes off.

## STEP 4 — recapture orbits when the view changes
In `setGraphView(v)`, right after its `const changed = ...; gView=v;` lines, add:

```js
  if (changed) gOrbitInit=false;   // recapture orbit radii for the new layout
```

## Tuning knobs (all in `initOrbits()`)
- **Speed**: the `speed` line — `(0.15+0.5/Math.sqrt(r))*(seed%2?1:-1)*0.02`. The trailing
  `*0.02` is the master speed. Bigger = faster. Inner orbits are already faster (the
  `/Math.sqrt(r)` term). The `(seed%2?1:-1)` mixes clockwise/counter-clockwise.
- **Ellipse amount / tilt**: `incl = (Math.sin(seed)*0.5+0.5)*1.1`. The `*1.1` is the max
  tilt in radians. Larger = more edge-on = flatter ellipses. `0` = flat circles facing you.
- **Min radius**: `Math.max(12, …)` keeps parts from sitting on top of their core.

## Behavior / gotchas
- Orbits only run in **galaxy** and **projects** views; in inventory ("inv") the normal
  force graph is unaffected.
- The **sun** node stays pinned at origin (handled in stepOrbits).
- **Trail edges** (project↔project, w<0) are ignored for parenting.
- It's frame-continuous, so leave it **default OFF**; it's a demo/show toggle.
- Needs **projects with BOM parts** to look like anything (orbits derive from BOM edges).
  Load/seed demo data with a few projects before evaluating.

## Optional (nice) — a settings/persist hook
If you want it to survive reloads: add `state.orbit` to your persisted state, set
`gOrbit=state.orbit` on boot, and `state.orbit=gOrbit; await save();` in the toggle.
(The mock did NOT persist it — it's a transient show mode.)

## Test checklist
1. Open the app with demo projects loaded.
2. `graph galaxy` (or `graph projects`), then `graph orbit`.
3. Wait ~1s for settle; parts should revolve around projects, projects around the sun.
4. Orbits should trace tilted ellipses (not flat circles) in 3D.
5. `graph orbit` again = motion stops (back to static force graph).
6. Switch to `graph inv` = normal inventory graph, no orbit behavior.
