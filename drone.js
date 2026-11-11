// Port of ADroneCameraPawn (DroneCam plugin 0.6.4): input, camera-drone modes, FPV, tricks, dials, dutch, camera feel, fence.
// Function names match the C++ so changes can be mirrored both ways. Lock-on / tracking and recording come in later steps.
import {
  v3, add, sub, mul, dot, len, size2D, clampSize, clamp, sign, D2R, R2D, SMALL,
  qIdent, qFromRot, qMul, qNorm, qRotate, qUnrotate, qForward, qRight, qUp, qSlerp, qAngularDistance, qToRot, rotQ,
  qMakeFromXZ, rotVector, normalizeAxis, findDeltaAngleDegrees, fInterpConstantTo, vInterpConstantTo,
} from './uemath.js';
import { MODES, FPV_CAMERAS } from './tuning.js';

const Gravity = 9.81;

/** Compass-style yaw of a body orientation, robust when the nose points straight up or down. */
export function headingOf(Q) {
  const F = qForward(Q);
  let fx = F.x, fy = F.y;
  if (fx * fx + fy * fy < 0.04) {
    const U = mul(qUp(Q), F.z < 0 ? 1 : -1);
    fx = U.x; fy = U.y;
  }
  return Math.atan2(fy, fx) * R2D;
}

export class DroneCameraPawn {
  /**
   * @param tuning  object from tuning.js (UE property names)
   * @param world   { groundHeight(x,y), groundNormal(x,y), resolveObstacles(pos, r) -> normal|null, origin:{x,y,z}, spawn:{x,y,z,yaw} }
   * @param flash   (message, color) => void  — on-screen messages, like GEngine->AddOnScreenDebugMessage
   */
  constructor(tuning, world, flash = () => {}) {
    this.T = tuning; this.world = world; this.flash = flash;
    this.FlightMode = MODES.includes(tuning.FlightMode) ? tuning.FlightMode : 'Normal';
    this.VelocityMS = v3(); this.YawRateDeg = 0; this.GimbalPitchDeg = 0;
    this.BodyQuat = qIdent(); this.ActorQuat = qIdent(); this.Location = v3();
    this.bTrickActive = false; this.TrickRate = { p: 0, y: 0, r: 0 }; this.TrickTimeLeft = 0; this.TrickThrustG = 0.3;
    this.PendingTrickSegments = []; this.TrickName = ''; this.bTrickComboUsed = false; this.TrickHeading = 0;
    this.FPVYawRate = 0; this.DutchDeg = 0; this.DutchSmoothed = 0; this.bDialComboUsed = false;
    this.SmoothedCamRot = { p: 0, y: 0, r: 0 }; this.SmoothedCamQuat = qIdent();
    this.LastSticks = { Throttle: 0, Yaw: 0, Forward: 0, Right: 0, Gimbal: 0 };
    this.External = { Throttle: 0, Yaw: 0, Forward: 0, Right: 0, Gimbal: 0 };
    this.bShowHUD = true;
    this.BeginPlay();
  }

  // ---------------- setup ----------------
  BeginPlay() {
    const s = this.world.spawn;
    this.StartTransform = { loc: v3(s.x, s.y, s.z), yaw: s.yaw };
    this.Location = v3(s.x, s.y, s.z);
    this.ActorQuat = qFromRot(0, s.yaw, 0); // airframe starts level
    this.GimbalPitchDeg = clamp(this.GimbalPitchDeg, this.T.MinGimbalPitch, this.T.MaxGimbalPitch);
    const initial = this.FlightMode; this.FlightMode = 'Normal'; this.SetFlightMode(initial);
    this.SnapCamera();
  }
  get isFPV() { return this.FlightMode === 'FPV'; }
  get actorYaw() { return qToRot(this.ActorQuat).y; }

  ModeLimitsRef() {
    const T = this.T;
    switch (this.FlightMode) { case 'Cine': return T.CineLimits; case 'Sport': case 'FPV': return T.SportLimits; default: return T.NormalLimits; }
  }
  /** Current mode's limits with the live Accel/Speed/Turn dials applied. */
  ActiveLimits() {
    const L = { ...this.ModeLimitsRef() };
    const A = clamp(L.AccelMultiplier, 0.1, 5), V = clamp(L.SpeedMultiplier, 0.1, 5), Tn = clamp(L.TurnMultiplier, 0.1, 5);
    L.HorizontalAccel *= A; L.VerticalAccel *= A; L.YawAccel *= A;
    L.MaxHorizontalSpeed *= V; L.MaxAscentSpeed *= V; L.MaxDescentSpeed *= V;
    L.MaxYawRate *= Tn; L.YawAccel *= Tn;
    return L;
  }
  CurrentTurnDial() { return clamp(this.isFPV ? this.T.FPV.TurnMultiplier : this.ModeLimitsRef().TurnMultiplier, 0.1, 5); }

  NudgeDial(which, dir) {
    const owner = this.isFPV ? this.T.FPV : this.ModeLimitsRef();
    const key = which === 2 ? 'TurnMultiplier' : which === 1 ? 'SpeedMultiplier' : 'AccelMultiplier';
    let d = clamp(owner[key] * (dir > 0 ? 1.1 : 1 / 1.1), 0.1, 5);
    if (Math.abs(d - 1) < 0.04) d = 1; // snaps back to the default
    owner[key] = d;
    this.flash(`${this.FlightMode} ${which === 2 ? 'TURN' : which === 1 ? 'SPEED' : 'ACCEL'}  x${d.toFixed(2)}`, 'cyan');
    this.onTuningChanged && this.onTuningChanged();
  }

  SetFlightMode(newMode) {
    const wasFPV = this.isFPV, isFPV = newMode === 'FPV';
    this.FlightMode = newMode;
    if (isFPV && !wasFPV) {
      this.BodyQuat = qFromRot(0, this.actorYaw, 0);
      this.YawRateDeg = 0;
      this.ActorQuat = this.BodyQuat;
    } else if (!isFPV && wasFPV) {
      this.bTrickActive = false;
      this.ActorQuat = qFromRot(0, headingOf(this.BodyQuat), 0);
      this.YawRateDeg = 0;
      const L = this.ActiveLimits();
      const h = clampSize(v3(this.VelocityMS.x, this.VelocityMS.y, 0), L.MaxHorizontalSpeed);
      this.VelocityMS = v3(h.x, h.y, clamp(this.VelocityMS.z, -L.MaxDescentSpeed, L.MaxAscentSpeed));
    }
  }
  FlashFlightMode() { this.flash(`Flight mode: ${this.FlightMode.toUpperCase()}`, 'cyan'); }
  CycleFlightMode(step = 1) { this.SetFlightMode(MODES[(MODES.indexOf(this.FlightMode) + step + 4) % 4]); }
  RecenterGimbal() { this.GimbalPitchDeg = this.GimbalPitchDeg > -45 ? Math.max(-90, this.T.MinGimbalPitch) : 0; }

  // ---------------- tricks ----------------
  CanStartTrick() {
    if (!this.isFPV) { this.flash("Tricks need FPV mode: hold B + RB (or LB) first. Camera drones can't flip.", 'yellow'); return false; }
    return !this.bTrickActive;
  }
  StartTrick(segments, name, pop) {
    if (!segments.length) return;
    this.PendingTrickSegments = segments.slice(1);
    const f = segments[0];
    this.TrickRate = f.rate; this.TrickTimeLeft = f.dur; this.TrickThrustG = f.g;
    this.TrickName = name; this.TrickHeading = headingOf(this.BodyQuat);
    this.bTrickActive = true;
    this.VelocityMS = add(this.VelocityMS, v3(0, 0, pop));
  }
  StepTrick(dt) {
    let remaining = dt;
    while (this.bTrickActive && remaining > 0) {
      const step = Math.min(remaining, this.TrickTimeLeft);
      const r = this.TrickRate;
      this.BodyQuat = qNorm(qMul(this.BodyQuat, qFromRot(r.p * step, r.y * step, r.r * step)));
      this.TrickTimeLeft -= step; remaining -= step;
      if (this.TrickTimeLeft <= SMALL) {
        if (this.PendingTrickSegments.length) {
          const n = this.PendingTrickSegments.shift();
          this.TrickRate = n.rate; this.TrickTimeLeft = n.dur; this.TrickThrustG = n.g;
        } else this.bTrickActive = false;
      }
      if (step <= 0 && this.bTrickActive && this.TrickTimeLeft <= 0) this.bTrickActive = false;
    }
  }
  Flip() {
    if (!this.CanStartTrick()) return;
    const S = this.T.FPV, dur = Math.max(S.FlipDuration, 0.15), rate = 360 / dur;
    const F = this.LastSticks.Forward, R = this.LastSticks.Right;
    let spin, name;
    if (Math.abs(R) > Math.abs(F) && Math.abs(R) > 0.3) { spin = { p: 0, y: 0, r: sign(R) * rate }; name = R > 0 ? 'ROLL RIGHT' : 'ROLL LEFT'; }
    else if (F < -0.3) { spin = { p: rate, y: 0, r: 0 }; name = 'BACK FLIP'; }
    else { spin = { p: -rate, y: 0, r: 0 }; name = 'FRONT FLIP'; }
    this.StartTrick([{ rate: spin, dur, g: 0.3 }], name, S.FlipPop);
  }
  PowerLoop() {
    if (!this.CanStartTrick()) return;
    const dur = Math.max(this.T.FPV.PowerLoopDuration, 0.5);
    this.StartTrick([{ rate: { p: 360 / dur, y: 0, r: 0 }, dur, g: this.T.FPV.PowerLoopThrust }], 'POWER LOOP', 0);
  }
  SplitS() {
    if (!this.CanStartTrick()) return;
    const dur = Math.max(this.T.FPV.SplitSDuration, 0.4), rollT = dur * 0.3, pullT = dur - rollT;
    this.StartTrick([
      { rate: { p: 0, y: 0, r: 180 / rollT }, dur: rollT, g: 0.4 },
      { rate: { p: 180 / pullT, y: 0, r: 0 }, dur: pullT, g: 2 }], 'SPLIT-S', 1);
  }
  YawSpin(dir) {
    if (!this.CanStartTrick()) return;
    const dur = Math.max(this.T.FPV.SpinDuration, 0.2), s = dir < 0 ? -1 : 1;
    this.StartTrick([{ rate: { p: 0, y: s * 360 / dur, r: 0 }, dur, g: 1 }], s > 0 ? 'SPIN RIGHT' : 'SPIN LEFT', 0);
  }
  BodyRollDeg() { return Math.asin(clamp(-qRight(this.BodyQuat).z, -1, 1)) * R2D; }
  BodyPitchDeg() { return Math.asin(clamp(qForward(this.BodyQuat).z, -1, 1)) * R2D; }

  ResetToStart() {
    const s = this.StartTransform;
    this.Location = { ...s.loc };
    this.VelocityMS = v3(); this.YawRateDeg = 0; this.bTrickActive = false; this.PendingTrickSegments = [];
    this.BodyQuat = qFromRot(0, s.yaw, 0); this.FPVYawRate = 0;
    this.ActorQuat = this.BodyQuat;
    this.SmoothedCamRot = { p: this.GimbalPitchDeg, y: s.yaw, r: 0 };
    this.SmoothedCamQuat = rotQ(this.SmoothedCamRot);
  }
  SetExternalSticks(Throttle, Yaw, Forward, Right, Gimbal) { this.External = { Throttle, Yaw, Forward, Right, Gimbal }; }
  ApplyStickShaping(v, expo) { v = clamp(v, -1, 1); return v * (1 - expo) + v * v * v * expo; }

  // ---------------- input (ReadSticks) ----------------
  ReadSticks(inp, rawDt) {
    const T = this.T, dz = T.StickDeadzone;
    const Axis = n => { const v = inp.axis(n); return Math.abs(v) < dz ? 0 : (v - sign(v) * dz) / (1 - dz); };
    const Held = k => (inp.down(k) ? 1 : 0), Pressed = k => inp.pressed(k), Released = k => inp.released(k);
    const S = { Throttle: 0, Yaw: 0, Forward: 0, Right: 0, Gimbal: 0 };
    const LX = Axis('LX'), LY = Axis('LY'), RX = Axis('RX'), RY = Axis('RY');
    const Triggers = inp.axis('RT') - inp.axis('LT');
    if (T.StickLayout === 'Game') { S.Forward = LY; S.Right = LX; S.Yaw = RX; S.Gimbal = RY; S.Throttle = Triggers; }
    else { S.Throttle = LY; S.Yaw = LX; S.Forward = RY; S.Right = RX; S.Gimbal = Triggers; }

    // Keyboard is the same in both layouts.
    S.Forward += Held('KeyW') - Held('KeyS');
    S.Right += Held('KeyD') - Held('KeyA');
    S.Throttle += Held('Space') - Held('ControlLeft');
    S.Yaw += Held('KeyE') - Held('KeyQ');
    S.Gimbal += Held('KeyX') - Held('KeyZ');

    const setMode = m => { this.SetFlightMode(m); this.FlashFlightMode(); };
    if (Pressed('Digit1')) setMode('Cine');
    if (Pressed('Digit2')) setMode('Normal');
    if (Pressed('Digit3')) setMode('Sport');
    if (Pressed('Digit4')) setMode('FPV');

    const bModifierB = inp.down('B');
    if (bModifierB) {
      if (Pressed('RB')) { this.CycleFlightMode(1); this.bDialComboUsed = true; this.FlashFlightMode(); }
      if (Pressed('LB')) { this.CycleFlightMode(-1); this.bDialComboUsed = true; this.FlashFlightMode(); }
    } else {
      if (Pressed('LB')) { this.CycleFlightMode(1); this.FlashFlightMode(); } // (switches targets once lock-on exists)
      if (Pressed('RB')) this.RecenterGimbal();
    }
    if (Pressed('KeyR') || Pressed('Menu')) this.flash('Recording arrives in step 2', 'yellow');
    if (Pressed('KeyG')) this.RecenterGimbal();
    if (Pressed('Backspace') || Pressed('View')) this.ResetToStart();
    if (Pressed('KeyH')) this.bShowHUD = !this.bShowHUD;
    if (Pressed('KeyT') || (!bModifierB && Pressed('L3'))) {
      T.FPV.bSelfLevel = !T.FPV.bSelfLevel;
      this.flash(T.FPV.bSelfLevel ? 'FPV: self-level ON (Angle mode)' : 'FPV: self-level OFF (Acro mode)', 'yellow');
      this.onTuningChanged && this.onTuningChanged();
    }
    if (Pressed('KeyC') || (!bModifierB && Pressed('R3'))) {
      T.FPV.CameraMode = FPV_CAMERAS[(FPV_CAMERAS.indexOf(T.FPV.CameraMode) + 1) % 3];
      this.flash(T.FPV.CameraMode === 'Stabilized' ? 'FPV camera: Stabilized (level)' : T.FPV.CameraMode === 'HorizonLock' ? 'FPV camera: Horizon Lock' : 'FPV camera: Body (classic FPV)', 'yellow');
      this.onTuningChanged && this.onTuningChanged();
    }
    if (Pressed('KeyV') || Pressed('X')) this.flash('Lock-on arrives in step 4', 'yellow');

    const bComboHeld = inp.down('B'), bTrickHeld = inp.down('Y');
    // Tricks (FPV). Tap Y = flip toward the stick; hold Y + D-pad = other tricks.
    if (bTrickHeld) {
      if (Pressed('DUp')) { this.PowerLoop(); this.bTrickComboUsed = true; }
      if (Pressed('DDown')) { this.SplitS(); this.bTrickComboUsed = true; }
      if (Pressed('DLeft')) { this.YawSpin(-1); this.bTrickComboUsed = true; }
      if (Pressed('DRight')) { this.YawSpin(1); this.bTrickComboUsed = true; }
    }
    if (Released('Y')) { if (!this.bTrickComboUsed) this.Flip(); this.bTrickComboUsed = false; }
    if (Pressed('KeyF')) this.Flip();
    if (Pressed('Digit5')) this.PowerLoop();
    if (Pressed('Digit6')) this.SplitS();
    if (Pressed('Digit7')) this.YawSpin(this.LastSticks.Yaw < -0.2 ? -1 : 1);
    if (Pressed('BracketRight')) this.NudgeDial(0, 1);
    if (Pressed('BracketLeft')) this.NudgeDial(0, -1);
    if (Pressed('Equal')) this.NudgeDial(1, 1);
    if (Pressed('Minus')) this.NudgeDial(1, -1);
    if (Pressed('Quote')) this.NudgeDial(2, 1);
    if (Pressed('Semicolon')) this.NudgeDial(2, -1);
    if (bComboHeld) {
      if (Pressed('DRight')) { this.NudgeDial(0, 1); this.bDialComboUsed = true; }
      if (Pressed('DLeft')) { this.NudgeDial(0, -1); this.bDialComboUsed = true; }
      if (Pressed('DUp')) { this.NudgeDial(1, 1); this.bDialComboUsed = true; }
      if (Pressed('DDown')) { this.NudgeDial(1, -1); this.bDialComboUsed = true; }
      if (Pressed('R3')) { this.NudgeDial(2, 1); this.bDialComboUsed = true; }
      if (Pressed('L3')) { this.NudgeDial(2, -1); this.bDialComboUsed = true; }
    }
    if (Released('B')) { if (!this.bDialComboUsed) this.DutchDeg = 0; this.bDialComboUsed = false; }
    if (Pressed('Slash')) this.DutchDeg = 0;
    const DutchInput = Held('Period') - Held('Comma') + ((bComboHeld || bTrickHeld) ? 0 : Held('DRight') - Held('DLeft'));
    this.DutchDeg = clamp(this.DutchDeg + DutchInput * T.DutchRate * rawDt, -T.MaxDutch, T.MaxDutch);
    if (Pressed('KeyL')) {
      T.StickLayout = T.StickLayout === 'Game' ? 'Mode2' : 'Game';
      this.flash(T.StickLayout === 'Game' ? 'Sticks: Game layout' : 'Sticks: Drone Mode 2', 'yellow');
      this.onTuningChanged && this.onTuningChanged();
    }

    const E = this.External;
    S.Throttle = clamp(S.Throttle + E.Throttle, -1, 1);
    S.Yaw = clamp(S.Yaw + E.Yaw, -1, 1);
    S.Forward = clamp(S.Forward + E.Forward, -1, 1);
    S.Right = clamp(S.Right + E.Right, -1, 1);
    S.Gimbal = clamp(S.Gimbal + E.Gimbal, -1, 1);
    if (T.bInvertCameraTilt) S.Gimbal = -S.Gimbal;
    this.LastSticks = S;
    return S;
  }

  // ---------------- Tick ----------------
  Tick(inp, deltaSeconds) {
    if (deltaSeconds <= 0) return;
    const Dt = Math.min(deltaSeconds, 0.05);
    const S = this.ReadSticks(inp, deltaSeconds);
    if (this.isFPV) this.TickFPV(S, Dt); else this.TickCameraDrone(S, Dt);
    this.UpdateCamera(Dt);
  }

  TickCameraDrone(Raw, Dt) {
    const L = this.ActiveLimits();
    const Throttle = this.ApplyStickShaping(Raw.Throttle, L.StickExpo);
    const YawStick = this.ApplyStickShaping(Raw.Yaw, L.StickExpo);
    const Forward = this.ApplyStickShaping(Raw.Forward, L.StickExpo);
    const Right = this.ApplyStickShaping(Raw.Right, L.StickExpo);

    this.YawRateDeg = fInterpConstantTo(this.YawRateDeg, YawStick * L.MaxYawRate, Dt, L.YawAccel);
    const Yaw = this.actorYaw + this.YawRateDeg * Dt;

    let db = v3(Forward, Right, 0);
    if (db.x * db.x + db.y * db.y > 1) db = mul(db, 1 / size2D(db)); // diagonals don't exceed max speed
    const DesiredH = qRotate(qFromRot(0, Yaw, 0), mul(db, L.MaxHorizontalSpeed));
    const NewH = vInterpConstantTo(v3(this.VelocityMS.x, this.VelocityMS.y, 0), DesiredH, Dt, L.HorizontalAccel);
    const DesiredV = Throttle >= 0 ? Throttle * L.MaxAscentSpeed : Throttle * L.MaxDescentSpeed;
    const NewV = fInterpConstantTo(this.VelocityMS.z, DesiredV, Dt, L.VerticalAccel);
    this.VelocityMS = v3(NewH.x, NewH.y, NewV);

    this.ActorQuat = qFromRot(0, Yaw, 0);
    this.MoveWithCollision(Dt);
    this.UpdateGimbalPitch(Raw, Dt);
  }

  TickFPV(Raw, Dt) {
    const S = this.T.FPV;
    const Pitch = this.ApplyStickShaping(Raw.Forward, S.RateExpo);
    const Roll = this.ApplyStickShaping(Raw.Right, S.RateExpo);
    const YawStick = this.ApplyStickShaping(Raw.Yaw, S.RateExpo);
    const MaxYaw = S.MaxYawRate * clamp(S.TurnMultiplier, 0.1, 5);

    const TargetYawRate = YawStick * MaxYaw;
    this.FPVYawRate = S.TurnRampTime <= SMALL ? TargetYawRate
      : this.FPVYawRate + (TargetYawRate - this.FPVYawRate) * (1 - Math.exp(-Dt / S.TurnRampTime));

    if (S.CameraMode === 'Stabilized') this.UpdateGimbalPitch(Raw, Dt);

    const bWasTricking = this.bTrickActive;
    if (this.bTrickActive) {
      this.StepTrick(Dt);
    } else if (S.bSelfLevel) {
      // Angle mode: sticks set a tilt, release = level. Turn stick = flat rotation around world up, applied in full.
      const StartHeading = headingOf(this.BodyQuat);
      const Fwd = rotVector(0, StartHeading);
      const FwdSpeed = dot(v3(this.VelocityMS.x, this.VelocityMS.y, 0), Fwd);
      let YawDelta = this.FPVYawRate * Dt;
      // Bank-to-turn: leaning with the move stick while flying forward curves you that way.
      if (S.BankToTurn > 0 && FwdSpeed > 2) {
        const RollRad = clamp(this.BodyRollDeg(), -80, 80) * D2R;
        YawDelta += (Gravity * Math.tan(RollRad) / FwdSpeed) * R2D * S.BankToTurn * Dt;
      }
      this.BodyQuat = qNorm(qMul(qFromRot(0, YawDelta, 0), this.BodyQuat));
      const Heading = headingOf(this.BodyQuat);

      let BankDeg = 0;
      if (S.TurnBank > 0) {
        const TurnRad = this.FPVYawRate * D2R;
        BankDeg = Math.atan(FwdSpeed * TurnRad / Gravity) * R2D * S.TurnBank;
      }
      const DesiredRoll = clamp(Roll * S.MaxTiltDeg + BankDeg, -S.MaxTiltDeg, S.MaxTiltDeg);
      const Target = qFromRot(-Pitch * S.MaxTiltDeg, Heading, DesiredRoll);
      const AngleDeg = qAngularDistance(this.BodyQuat, Target) * R2D;
      if (AngleDeg > SMALL) {
        const Wanted = AngleDeg * (1 - Math.exp(-10 * Dt));
        const Step = Math.min(Wanted, S.MaxRollPitchRate * Dt);
        this.BodyQuat = qSlerp(this.BodyQuat, Target, Step / AngleDeg);
      }
    } else {
      // Acro mode: sticks set rotation rates in the body frame; nothing levels for you.
      this.BodyQuat = qNorm(qMul(this.BodyQuat, qFromRot(-Pitch * S.MaxRollPitchRate * Dt, this.FPVYawRate * Dt, Roll * S.MaxRollPitchRate * Dt)));
    }

    // Thrust: center stick = hover, full up = ThrustToWeight, full down = dive (DivePower g pushing down).
    const Tq = Raw.Throttle;
    const AccelDial = clamp(S.AccelMultiplier, 0.1, 5);
    const TtW = 1 + (S.ThrustToWeight - 1) * AccelDial;
    const Drag = S.Drag / clamp(S.SpeedMultiplier, 0.1, 5);
    const ThrustG = Tq >= 0 ? 1 + Tq * (TtW - 1) : 1 + Tq * (1 + S.DivePower * AccelDial);
    const Up = qUp(this.BodyQuat);
    let Thrust;
    if (this.bTrickActive || bWasTricking) {
      Thrust = mul(Up, this.TrickThrustG * Gravity); // flips cut throttle; loops pull hard
    } else {
      const BodyG = Math.max(ThrustG, 0), DiveG = Math.min(ThrustG, 0);
      if (S.bSelfLevel) {
        const UpZ = Math.max(Up.z, 0.5);
        const Travel = Math.max(BodyG, 1) / UpZ * Gravity * AccelDial;
        Thrust = v3(Up.x * Travel, Up.y * Travel, (BodyG + DiveG) * Gravity);
      } else {
        Thrust = add(mul(Up, BodyG * Gravity), v3(0, 0, DiveG * Gravity));
      }
    }
    const Accel = sub(sub(Thrust, v3(0, 0, Gravity)), mul(this.VelocityMS, Drag));
    this.VelocityMS = add(this.VelocityMS, mul(Accel, Dt));
    this.ActorQuat = this.BodyQuat;
    this.MoveWithCollision(Dt);
  }

  UpdateGimbalPitch(Raw, Dt) {
    const L = this.ActiveLimits();
    const Stick = this.ApplyStickShaping(Raw.Gimbal, L.StickExpo);
    this.GimbalPitchDeg = clamp(this.GimbalPitchDeg + Stick * L.GimbalPitchRate * Dt, this.T.MinGimbalPitch, this.T.MaxGimbalPitch);
  }

  SnapCamera() {
    this.SmoothedCamRot = { p: this.GimbalPitchDeg, y: this.actorYaw, r: 0 };
    this.SmoothedCamQuat = rotQ(this.SmoothedCamRot);
  }

  UpdateCamera(Dt) {
    const T = this.T, F = T.FPV, CF = T.CameraFeel;
    const Alpha = lag => (lag <= SMALL ? 1 : 1 - Math.exp(-Dt / lag));
    const bFPV = this.isFPV;
    const bRideFlip = bFPV && this.bTrickActive && F.bCameraDoesFlips;
    if (!bRideFlip && (!bFPV || F.CameraMode === 'Stabilized')) {
      const TargetYaw = !bFPV ? this.actorYaw : (this.bTrickActive ? this.TrickHeading : headingOf(this.BodyQuat));
      const YawA = Alpha(CF.TurnSmoothing), TiltA = Alpha(CF.TiltSmoothing);
      const R = this.SmoothedCamRot;
      R.y = normalizeAxis(R.y + findDeltaAngleDegrees(R.y, TargetYaw) * YawA);
      let TargetRoll = 0, PitchAdd = 0;
      if (bFPV) { TargetRoll = this.BodyRollDeg() * F.CameraBankFollow; PitchAdd = this.BodyPitchDeg() * F.CameraPitchFollow; }
      R.p += (this.GimbalPitchDeg + PitchAdd - R.p) * TiltA;
      R.r += (TargetRoll - R.r) * TiltA;
      this.SmoothedCamQuat = rotQ(R);
    } else {
      const bGimbalCam = bRideFlip && F.CameraMode === 'Stabilized';
      const BodyCam = qMul(this.BodyQuat, qFromRot(bGimbalCam ? this.GimbalPitchDeg : F.CameraUptiltDeg, 0, 0));
      let Target = BodyCam;
      if (F.CameraMode === 'HorizonLock' && !bRideFlip) {
        const Fwd = qForward(BodyCam);
        Target = Math.abs(Fwd.z) < 0.98 ? qMakeFromXZ(Fwd, v3(0, 0, 1)) : this.SmoothedCamQuat;
      }
      this.SmoothedCamQuat = qSlerp(this.SmoothedCamQuat, Target, Alpha(CF.FPVCameraSmoothing));
      this.SmoothedCamRot = qToRot(this.SmoothedCamQuat);
    }
    this.DutchSmoothed += (this.DutchDeg - this.DutchSmoothed) * Alpha(CF.TiltSmoothing);
  }

  /** Camera world transform (UE coordinates, meters): Gimbal sits 15 cm forward, 12 cm down from the root. */
  CameraTransform() {
    const loc = add(this.Location, qRotate(this.ActorQuat, v3(0.15, 0, -0.12)));
    const q = qMul(this.SmoothedCamQuat, qFromRot(0, 0, this.DutchSmoothed));
    return { loc, q, fwd: qForward(q), up: qUp(q) };
  }

  // ---------------- movement ----------------
  MoveWithCollision(Dt) {
    let delta = mul(this.VelocityMS, Dt);
    delta = this.ApplyFence(delta);
    let p = add(this.Location, delta);
    const r = this.T.CollisionRadiusM;
    let N = null;
    const gh = this.world.groundHeight(p.x, p.y);
    if (p.z < gh + r) { p.z = gh + r; N = this.world.groundNormal(p.x, p.y); }
    const n2 = this.world.resolveObstacles(p, r);
    if (n2) N = N ? safeAvg(N, n2) : n2;
    this.Location = p;
    if (N) {
      const Into = dot(this.VelocityMS, N);
      if (Into < 0) this.VelocityMS = sub(this.VelocityMS, mul(N, Into));
      this.VelocityMS = mul(this.VelocityMS, 0.9); // scrape friction
      this.bHitThisFrame = true;
    } else this.bHitThisFrame = false;
  }

  /** NEU = meters North/East/Up from the takeoff point (the app's Geo Origin). */
  NEU(p = this.Location) { const o = this.world.origin; return v3(p.x - o.x, p.y - o.y, p.z - o.z); }

  ApplyFence(delta) {
    const T = this.T, o = this.world.origin;
    const next = add(this.Location, delta);
    const NEU = this.NEU(next);
    let clamped = false;
    if (NEU.z > T.MaxAltitudeM) { NEU.z = T.MaxAltitudeM; this.VelocityMS.z = Math.min(this.VelocityMS.z, 0); clamped = true; }
    const dist = Math.hypot(NEU.x, NEU.y);
    if (dist > T.MaxDistanceM && dist > 0) {
      NEU.x *= T.MaxDistanceM / dist; NEU.y *= T.MaxDistanceM / dist;
      const out = v3(NEU.x / T.MaxDistanceM, NEU.y / T.MaxDistanceM, 0);
      const o2 = dot(this.VelocityMS, out);
      if (o2 > 0) this.VelocityMS = sub(this.VelocityMS, mul(out, o2));
      clamped = true;
    }
    this.bFenced = clamped;
    if (clamped) return sub(v3(NEU.x + o.x, NEU.y + o.y, NEU.z + o.z), this.Location);
    return delta;
  }

  // ---------------- HUD data ----------------
  HudState() {
    const NEU = this.NEU();
    const heading = (((this.isFPV ? headingOf(this.BodyQuat) : this.actorYaw) % 360) + 360) % 360;
    const base = this.ModeLimitsRef(), F = this.T.FPV;
    return {
      mode: this.FlightMode === 'FPV' ? (F.bSelfLevel ? 'FPV ANGLE' : 'FPV ACRO') : this.FlightMode.toUpperCase(),
      hSpeed: size2D(this.VelocityMS), vSpeed: this.VelocityMS.z, speedKmh: len(this.VelocityMS) * 3.6,
      alt: NEU.z, dist: Math.hypot(NEU.x, NEU.y), heading, gimbal: this.GimbalPitchDeg,
      fpvCam: F.CameraMode, layout: this.T.StickLayout,
      accel: this.isFPV ? F.AccelMultiplier : base.AccelMultiplier,
      speedDial: this.isFPV ? F.SpeedMultiplier : base.SpeedMultiplier,
      turn: this.CurrentTurnDial(), dutch: this.DutchSmoothed,
      trick: this.bTrickActive ? this.TrickName : '', fenced: this.bFenced,
      nearFence: Math.hypot(NEU.x, NEU.y) > this.T.MaxDistanceM - 40 || NEU.z > this.T.MaxAltitudeM - 10,
    };
  }
}

function safeAvg(a, b) { const s = add(a, b); const l = len(s); return l < 1e-6 ? a : mul(s, 1 / l); }
