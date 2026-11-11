import * as M from '../js/uemath.js';
import { DroneCameraPawn, headingOf } from '../js/drone.js';
import { defaultTuning } from '../js/tuning.js';
let fails=0; const ok=(c,m)=>{ if(!c){fails++;console.log('FAIL',m)} else console.log('ok  ',m) };
const near=(a,b,e=1e-4)=>Math.abs(a-b)<e, nv=(a,b,e=1e-4)=>near(a.x,b.x,e)&&near(a.y,b.y,e)&&near(a.z,b.z,e);
ok(nv(M.qForward(M.qFromRot(90,0,0)),M.v3(0,0,1)),'pitch +90 points nose up');
ok(nv(M.qForward(M.qFromRot(0,90,0)),M.v3(0,1,0)),'yaw +90 turns X->Y (right/east)');
ok(nv(M.qRight(M.qFromRot(0,0,90)),M.v3(0,0,-1)),'roll +90 puts right side down');
for (const r of [{p:30,y:-120,r:15},{p:-70,y:45,r:-160},{p:10,y:179,r:5}]) { const b=M.qToRot(M.qFromRot(r.p,r.y,r.r)); ok(near(b.p,r.p,1e-3)&&near(M.normalizeAxis(b.y),M.normalizeAxis(r.y),1e-3)&&near(M.normalizeAxis(b.r),M.normalizeAxis(r.r),1e-3),`rotator round trip ${JSON.stringify(r)}`); }
const q=M.qFromRot(25,70,-30); const q2=M.qFromAxes(M.qForward(q),M.qRight(q),M.qUp(q)); ok(nv(M.qForward(q2),M.qForward(q))&&nv(M.qUp(q2),M.qUp(q)),'matrix->quat matches UE');
const h=M.qMakeFromXZ(M.qForward(q),M.v3(0,0,1)); ok(near(M.qRight(h).z,0)&&nv(M.qForward(h),M.qForward(q)),'MakeFromXZ removes roll');
ok(near(headingOf(M.qFromRot(-89.9,37,0)),37,0.5),'heading robust nose-down');
ok(near(M.qAngularDistance(M.qIdent(),M.qFromRot(0,90,0))*M.R2D,90,1e-3),'AngularDistance');
// sim
const world={groundHeight:()=>0,groundNormal:()=>M.v3(0,0,1),resolveObstacles:()=>null,origin:M.v3(0,0,0),spawn:{x:0,y:0,z:5,yaw:0}};
const mk=(axes={},btn=new Set())=>({axis:n=>axes[n]||0,down:b=>btn.has(b),pressed:()=>false,released:()=>false});
let d=new DroneCameraPawn(defaultTuning(),world); for(let i=0;i<600;i++) d.Tick(mk({LY:1}),1/60);
ok(near(d.VelocityMS.x,10,0.05)&&near(d.Location.z,5,0.01),`Normal: full forward reaches 10 m/s north (${d.VelocityMS.x.toFixed(2)})`);
d=new DroneCameraPawn(defaultTuning(),world); d.SetFlightMode('FPV'); for(let i=0;i<300;i++) d.Tick(mk(),1/60);
ok(near(d.Location.z,5,0.05),`FPV centre stick hovers (z=${d.Location.z.toFixed(3)})`);
d=new DroneCameraPawn(defaultTuning(),world); d.SetFlightMode('FPV'); for(let i=0;i<120;i++) d.Tick(mk({LY:1}),1/60);
ok(d.VelocityMS.x>5 && d.BodyPitchDeg()<-30,`FPV forward stick tilts nose down and flies forward (v=${d.VelocityMS.x.toFixed(1)}, pitch=${d.BodyPitchDeg().toFixed(0)})`);
d=new DroneCameraPawn(defaultTuning(),world); d.SetFlightMode('FPV'); d.Location.z=40; d.Flip(); for(let i=0;i<60;i++) d.Tick(mk(),1/60);
ok(!d.bTrickActive && Math.abs(d.BodyPitchDeg())<5,`front flip completes a full 360 (pitch after ${d.BodyPitchDeg().toFixed(1)})`);
d=new DroneCameraPawn(defaultTuning(),world); d.SetFlightMode('FPV'); for(let i=0;i<120;i++) d.Tick(mk({RX:1}),1/60);
ok(Math.abs(d.BodyRollDeg())<1 && Math.abs(M.normalizeAxis(headingOf(d.BodyQuat)))>100,'right stick = flat rotate, no bank (TurnBank 0)');
console.log(fails?`${fails} FAILED`:'ALL PASS');
