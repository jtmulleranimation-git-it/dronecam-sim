// Tuning values, named exactly like the UPROPERTYs on ADroneCameraPawn (DroneCam plugin 0.6.4)
// so the app and the Unreal rig stay in sync. Defaults = the C++ constructor / struct defaults.

export const PLUGIN_VERSION = '0.6.4';
export const APP_VERSION = '0.1.0';

export const MODES = ['Cine', 'Normal', 'Sport', 'FPV'];
export const FPV_CAMERAS = ['Stabilized', 'HorizonLock', 'Body'];

const limits = (H, Up, Down, Yaw, HAcc, VAcc, YawAcc, Gimbal, Expo) => ({
  MaxHorizontalSpeed: H, MaxAscentSpeed: Up, MaxDescentSpeed: Down, MaxYawRate: Yaw,
  HorizontalAccel: HAcc, VerticalAccel: VAcc, YawAccel: YawAcc, GimbalPitchRate: Gimbal, StickExpo: Expo,
  AccelMultiplier: 1, SpeedMultiplier: 1, TurnMultiplier: 1,
});

export function defaultTuning() {
  return {
    StickLayout: 'Game', // 'Game' | 'Mode2'
    bInvertCameraTilt: false,
    StickDeadzone: 0.08,
    FlightMode: 'Normal',
    //                    H   Up   Down Yaw  HAcc VAcc YawAcc Gimbal Expo
    CineLimits: limits(3, 1.5, 1.5, 30, 1.5, 1.0, 60, 15, 0.5),
    NormalLimits: limits(10, 4, 3, 90, 5, 3.0, 270, 45, 0.2),
    SportLimits: limits(16, 6, 5, 200, 9, 5, 600, 90, 0.1),
    FPV: {
      bSelfLevel: true, CameraMode: 'Stabilized', bCameraDoesFlips: true, TurnRampTime: 0.1,
      MaxTiltDeg: 50, MaxRollPitchRate: 600, MaxYawRate: 300, RateExpo: 0.4, ThrustToWeight: 4, Drag: 0.35,
      CameraUptiltDeg: 20, AccelMultiplier: 1, SpeedMultiplier: 1, TurnMultiplier: 1,
      FlipDuration: 0.45, FlipPop: 3, DivePower: 2, TurnBank: 0, BankToTurn: 0.6,
      CameraBankFollow: 0.5, CameraPitchFollow: 0,
      PowerLoopDuration: 1.6, PowerLoopThrust: 2.5, SplitSDuration: 1.2, SpinDuration: 0.7,
    },
    DutchRate: 30, MaxDutch: 45,
    CameraFeel: { TurnSmoothing: 0.12, TiltSmoothing: 0.12, FPVCameraSmoothing: 0.03 },
    MinGimbalPitch: -90, MaxGimbalPitch: 20,
    MaxAltitudeM: 120, MaxDistanceM: 500,
    // UCineCameraComponent defaults in the pawn constructor (4/3 sensor, 24 mm full-frame equivalent).
    Camera: { SensorWidth: 17.3, SensorHeight: 13.0, CurrentFocalLength: 12.3 },
    CollisionRadiusM: 0.35, // USphereComponent radius 35 cm
  };
}

// ---- saving (one viewer, this device) ----
const KEY = 'dronecam-sim-tuning-v1';
function merge(base, over) {
  for (const k in over) {
    if (!(k in base)) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], over[k] || {});
    else if (typeof over[k] === typeof base[k]) base[k] = over[k];
  }
  return base;
}
export function loadTuning() {
  const t = defaultTuning();
  try { const s = localStorage.getItem(KEY); if (s) merge(t, JSON.parse(s)); } catch (e) { /* storage unavailable */ }
  return t;
}
export function saveTuning(t) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { /* ignore */ } }
export function resetTuning() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } return defaultTuning(); }
export const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
export function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }
