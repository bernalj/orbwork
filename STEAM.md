# Orbwork on Steam

The desktop build wraps the same `index.html` that GitHub Pages serves, using [Electron](https://www.electronjs.org/) and [steamworks.js](https://github.com/ceifa/steamworks.js). The web version doesn't change: the desktop-only features switch on only when `window.orbworkHost` exists.

## Layout

| Path | What it is |
|---|---|
| `electron/main.js` | Window, fullscreen (F11 / Alt+Enter), save file, single instance, IPC |
| `electron/preload.js` | Exposes `window.orbworkHost` to the game |
| `electron/steam.js` | Steam init, App ID lookup, achievement unlocks (no-ops without Steam) |
| `electron/achievements.js` | Achievement list and unlock rules |
| `fonts/` | Self-hosted Lilita One + Nunito (OFL), so the game works offline |
| `steam/*.vdf` | SteamPipe upload scripts |
| `test/smoke.js` | Scripted smoke test: real app, throwaway profile, screenshots |

## Commands

```bash
npm install
npm start            # run the desktop build from source
npm run dist         # build dist/win-unpacked/ (the folder Steam uploads)
```

Environment switches:

- `ORBWORK_NO_STEAM=1` skips Steam entirely.
- `ORBWORK_STEAM_APPID=123` forces an App ID.
- `ORBWORK_STEAM_RESET_ACHIEVEMENTS=1` re-locks this build's achievements at startup (for testing).
- `ORBWORK_DEVTOOLS=1` enables F12 in packaged builds.

## How it behaves on desktop

- **Saves** go to `%APPDATA%\Orbwork\saves\save.json`, mirrored to localStorage. That folder holds only the save, so Steam Auto-Cloud can sync it.
- **Window:** the first launch is windowed, 1080 wide (3:2, centered; smaller on small screens). F11, Alt+Enter or *Settings → Display* switches to fullscreen. Size, position and mode are remembered in `%APPDATA%\Orbwork\settings.json`. On Steam Deck (`SteamDeck=1`) the game is always fullscreen.
- **Front end:** splash card → title screen (orblings from every world fall in; drag and throw them) → main menu (Continue / New Game, Level Select, Settings, Credits, Quit). Esc or the HUD **Menu** button pauses the game: Resume, Restart level, Level Select, Settings, Main Menu, Quit. Menus work with the mouse or the arrow keys plus Enter.
- **Settings:** volume (saved per machine in localStorage), windowed or fullscreen, and reset progress.
- **Keyboard:**
  - Z, U, Backspace or Ctrl+Z: Undo
  - R: Restart
  - M: Map
  - N: Notebook
  - Esc: close a sheet, or pause
  - Enter or Space: Next level after a win

  These also work on the web.
- **Quit** is in the main menu and the pause menu (desktop only).
- **Achievements** are recomputed from the save each time progress changes. Progress made before Steam was connected unlocks retroactively on the next launch.

## Testing with Steam before you have an App ID

With no App ID configured, the game uses **Spacewar (480)**, Valve's public test app. Spacewar has only five sample achievements, so three of ours are mapped onto them (`SPACEWAR_TEST_MAP` in `electron/achievements.js`):

| Orbwork | Spacewar achievement it unlocks |
|---|---|
| `FIRST_NOTE` (learn your first rule) | `NEW_ACHIEVEMENT_0_4` |
| `FIRST_POP` (open your first Gate) | `ACH_WIN_ONE_GAME` |
| `CLEAR_HATCHERY` | `ACH_TRAVEL_FAR_ACCUM` |

To try it:

1. Start the Steam client.
2. Run `dist\win-unpacked\Orbwork.exe`. Steam should show you as playing "Spacewar".
3. Solve level 1. The two achievements unlock, and you can see them on Spacewar's achievements page in Steam.
4. For the overlay and pop-ups, add `Orbwork.exe` as a **Non-Steam Game** in your library and launch it from there. Shift+Tab opens the overlay.

## Shipping checklist

1. **Steamworks account.** Sign up at partner.steamgames.com, pay the $100 Steam Direct fee, and fill in the tax and bank forms. You'll get an **App ID** and a Windows **Depot ID** (usually App ID + 1).
2. **Set the App ID.** Put it in `package.json` → `"steamAppId"` and rebuild. Packaged builds then relaunch through Steam when started outside it.
3. **Achievements.** On the Steamworks *Stats & Achievements* page, create each entry below with exactly this API name, upload icons (256×256 unlocked plus a grey locked version), then **Publish** the changes.

   | API name | Name | Description |
   |---|---|---|
   | `FIRST_POP` | First pop | Open your first Gate. |
   | `FIRST_NOTE` | Field notes | Write your first Notebook entry. |
   | `CLEAR_HATCHERY` | Hatchery done | Finish every main level of the Hatchery. |
   | `CLEAR_COMMONS` | Commons done | Finish every main level of the Commons. |
   | `CLEAR_NURSERY` | Nursery done | Finish every main level of the Nursery. |
   | `CLEAR_REEF` | Reef done | Finish every main level of the Reef. |
   | `CLEAR_QUEUE` | Queue done | Finish every main level of the Queue. |
   | `CLEAR_SEESAW` | Seesaw done | Finish every main level of the Seesaw. |
   | `CLEAR_LIGHTHOUSE` | Lighthouse done | Finish every main level of the Lighthouse. |
   | `FIRST_REMIX` | Mixed company | Finish a Remix level. |
   | `ALL_REMIX` | Remixed | Finish every Remix level. |
   | `PAR_WORLD` | Under par | Earn three stars on every main level of any world. |
   | `ALL_LEVELS` | Orbwork | Finish every level in the game. |
   | `ALL_STARS` | Every star | Earn three stars on every level in the game. |

4. **Steam Cloud.** Under *Steam Cloud* → *Auto-Cloud*, set the byte and file quotas (e.g. 1 MB, 10 files), then add a Root Path:
   - Root: `WinAppDataRoaming`
   - Subdirectory: `Orbwork/saves`
   - Pattern: `save.json`
5. **Launch option.** Under *Installation* → *General*, set the executable to `Orbwork.exe` with OS Windows.
6. **Build and upload.**
   - Run `npm run dist`.
   - Replace `APPID` and `DEPOTID` in `steam/app_build.vdf` and `steam/depot_build_windows.vdf`.
   - Download the Steamworks SDK and upload with its `steamcmd`:
     ```bash
     steamcmd +login <your_steam_build_account> +run_app_build "C:\Users\xlona\Documents\Dev\orbwork\steam\app_build.vdf" +quit
     ```
   - In Steamworks → *SteamPipe* → *Builds*, set the uploaded build live on a branch (start with a private `beta` branch to test).
7. **Store page.** You'll need:
   - Capsule images: header 920×430, small 462×174, main 1232×706, vertical 748×896
   - Library assets: capsule 600×900, hero 3840×1240, logo
   - At least 5 screenshots and a trailer
   - Description, tags and content survey
8. **Review.** Submit the store page and the build for Valve's review. Your first app can't release until 30 days after you pay the fee.

## Notes

- The build is about 320 MB unpacked (Electron's Chromium runtime). Steam compresses depots, so the download is smaller.
- Steam Deck: add controller support (Steam Input) for "Deck Verified". Until then, trackpad and touchscreen play works because the game uses pointer events.
