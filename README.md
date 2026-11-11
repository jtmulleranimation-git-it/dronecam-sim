# DroneCam Sim (iPad practice app) — step 1: flight

Your DroneCam Unreal rig on the iPad: the same flight modes, stick layout, tricks, dials and tuning as
**DroneCam plugin 0.6.4**, running offline as a home-screen app with an Xbox controller.

## What's in step 1

- **Flight model ported line for line** from `ADroneCameraPawn` (`js/drone.js`): Cine / Normal / Sport camera-drone limits,
  FPV with self-level (Angle) and Acro, Bank To Turn, Dive Power, thrust-to-weight, drag, flips, power loop, split-S,
  yaw spin, the three FPV cameras (Stabilized, Horizon Lock, Body), Camera Feel smoothing, dutch, live dials, fence.
- **Same controls** as the plugin's Game layout (Mode 2 too). Tap **?** in the app for the full list.
- **Same tuning names**: `js/tuning.js` uses the UPROPERTY names (`FPV.BankToTurn`, `CameraFeel.TurnSmoothing`, ...),
  so values can be copied between the app and the Details panel. Settings › *Copy tuning as JSON* exports them.
- **Practice course**: a twisty mountain loop with hairpins (about 3.7 km), forest, 10 FPV gates, and the
  500 m / 120 m fence drawn as a red ring around the takeoff pad.
- **Offline**: a service worker stores everything on the iPad after the first load.

Not yet: recording and the chase car (step 2), loading your real road from UE (step 3), lock-on (step 4).

## Put it on your iPad (one time, about 10 minutes, on your PC)

The app has to be served once over HTTPS so the iPad can install it. GitHub Pages is free and works well.

1. Sign in at github.com (create a free account if needed).
2. Top right **+ › New repository**. Name it `dronecam-sim`, set **Public**, click **Create repository**.
3. On the new repo page click **uploading an existing file**. Drag in **everything inside** the `dronecam-sim`
   folder (`index.html`, `sw.js`, `manifest.webmanifest`, and the `js`, `vendor`, `icons` folders). Click **Commit changes**.
4. **Settings › Pages**. Under *Branch* choose **main** and **/ (root)**, click **Save**. After a minute the page shows
   your link, like `https://YOURNAME.github.io/dronecam-sim/`.
5. On the iPad, open that link in **Safari**. Tap **Share › Add to Home Screen**.
6. Open it once from the home screen while online, so it saves itself for offline use. After that it works on a plane.

**Controller:** iPad **Settings › Bluetooth**, hold the pairing button on top of the Xbox controller until the logo
flashes fast, tap it in the list. In the app, press any button on the controller to wake it up.

**Updating later:** upload the changed files to the same repo, then open the app once while online. It picks up
the new version the next time it starts. (Each update changes `CACHE` in `sw.js`, so the old copy gets replaced.)

## Files

| File | What it is |
|---|---|
| `js/drone.js` | Port of `ADroneCameraPawn` (function names match the C++) |
| `js/uemath.js` | Unreal's FRotator / FQuat math, so angles and axes behave exactly like UE |
| `js/tuning.js` | Defaults from the plugin, saved per device |
| `js/world.js` | Practice course (terrain, road, trees, gates) in UE axes: X north, Y east, Z up, meters |
| `js/input.js` | Xbox controller (Gamepad API), keyboard, touch sticks |
| `sw.js`, `manifest.webmanifest` | Offline cache and home-screen app settings |
| `tests/math.test.mjs` | `node tests/math.test.mjs` checks the UE math and flight behaviour |

## Keeping it in sync with the plugin

When the plugin's flight code changes, the matching function in `js/drone.js` changes the same way, and
`PLUGIN_VERSION` in `js/tuning.js` is bumped. The app shows which plugin version it matches in Settings.
