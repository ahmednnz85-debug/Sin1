/* Geometry-aware routes for palace streaming and sightlines. */
(function (root,factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SinPalaceRoutes=api;
})(typeof window!=='undefined'?window:null,function () {
  'use strict';
  function sharedMouth(a,b) {
    const z0=Math.max(a.z0,b.z0),z1=Math.min(a.z1,b.z1);
    if(z1-z0>.16 && (Math.abs(a.x1-b.x0)<.17||Math.abs(b.x1-a.x0)<.17)){
      const x=Math.abs(a.x1-b.x0)<.17?(a.x1+b.x0)/2:(b.x1+a.x0)/2;
      return {x,z:(z0+z1)/2,axis:'x',width:z1-z0,thickness:.07};
    }
    const x0=Math.max(a.x0,b.x0),x1=Math.min(a.x1,b.x1);
    if(x1-x0>.16 && (Math.abs(a.z1-b.z0)<.17||Math.abs(b.z1-a.z0)<.17)){
      const z=Math.abs(a.z1-b.z0)<.17?(a.z1+b.z0)/2:(b.z1+a.z0)/2;
      return {x:(x0+x1)/2,z,axis:'z',width:x1-x0,thickness:.07};
    }
    // Some corridor polygons overlap intentionally at an elbow.
    if(x1-x0>.16&&z1-z0>.16){
      return x1-x0>=z1-z0?{x:(x0+x1)/2,z:(z0+z1)/2,axis:'z',width:x1-x0,thickness:.07}:
        {x:(x0+x1)/2,z:(z0+z1)/2,axis:'x',width:z1-z0,thickness:.07};
    }
    return null;
  }
  function create(regions,links,doors) {
    const byId=new Map(regions.map(r=>[r.id,r])), portals=new Map(doors.map(p=>[p.id,p]));
    const routes=new Map();
    for(const [a,b,id] of links){
      const one=byId.get(a),two=byId.get(b);
      if(!one||!two)continue;
      const existing=portals.get(id), derived=existing?null:sharedMouth(one.bbox,two.bbox);
      const portal=existing||(derived&&{id,from:a,to:b,...derived});
      if(!portal)continue;
      if(!routes.has(a))routes.set(a,[]);
      if(!routes.has(b))routes.set(b,[]);
      routes.get(a).push({to:b,portal});
      routes.get(b).push({to:a,portal});
    }
    function connectedView(origin,camera,through,pass) {
      const result=new Set([origin]);
      if(!camera)return result;
      const queue=[{id:origin,openings:[],path:[origin]}];
      for(let i=0;i<queue.length;i++){
        const {id,openings,path}=queue[i];
        if(openings.length>=8)continue;
        for(const {to,portal} of routes.get(id)||[]){
          if(path.includes(to)||!pass(portal))continue;
          const line=[...openings,portal];
          if(!through(camera,line,.055))continue;
          result.add(to);queue.push({id:to,openings:line,path:[...path,to]});
        }
      }
      return result;
    }
    function nextRoom(origin,moving,streamed,estimate) {
      if(!moving)return null;
      const speed=Math.hypot(moving.vx,moving.vz);
      if(speed<.18)return null;
      let best=null;
      const queue=[{id:origin,dist:0,x:moving.x,z:moving.z,path:[origin],alignment:1}];
      for(let i=0;i<queue.length;i++){
        const candidate=queue[i];
        for(const {to,portal} of routes.get(candidate.id)||[]){
          if(candidate.path.includes(to))continue;
          const dx=portal.x-candidate.x,dz=portal.z-candidate.z;
          const length=Math.hypot(dx,dz);
          const alignment=candidate.path.length===1?(length>.08?(dx*moving.vx+dz*moving.vz)/(length*speed):1):candidate.alignment;
          // A wall may be close in Euclidean distance. Only consider the
          // first real connected opening when movement points toward it.
          if(candidate.path.length===1&&alignment<.28)continue;
          const dist=candidate.dist+length;
          const target=byId.get(to),isRoom=target.kind==='room';
          if(streamed.has(to)){
            const lead=Math.max(14,Math.min(47,6.5+speed*estimate(to)));
            if(dist>lead)continue;
            const score=dist+(1-alignment)*5;
            if(!best||score<best.score)best={id:to,distance:dist,score,first:candidate.path[1]||to};
          }else if(!isRoom&&candidate.path.length<5&&dist<47){
            queue.push({id:to,dist,x:portal.x,z:portal.z,path:[...candidate.path,to],alignment});
          }
        }
      }
      return best;
    }
    function nearRoom(origin,moving,streamed,ready) {
      if(!moving)return null;
      let closest=null,gap=Infinity;
      for(const {to,portal} of routes.get(origin)||[]){
        if(!streamed.has(to)||ready(to))continue;
        const normal=portal.axis==='x'?moving.x-portal.x:moving.z-portal.z;
        const span=portal.axis==='x'?moving.z-portal.z:moving.x-portal.x;
        if(Math.abs(span)>portal.width/2+.35||Math.abs(normal)>2.65)continue;
        if(Math.abs(normal)<gap){gap=Math.abs(normal);closest=to;}
      }
      return closest;
    }
    return {nextRoom,nearRoom,connectedView};
  }
  return {create};
});
