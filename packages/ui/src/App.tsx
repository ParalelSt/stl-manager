import { ApplyScreen } from "./screens/ApplyScreen.js";
import { HistoryScreen } from "./screens/HistoryScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { ReviewScreen } from "./screens/ReviewScreen.js";
import { ScanScreen } from "./screens/ScanScreen.js";
import { SetupScreen } from "./screens/SetupScreen.js";
import { SCREEN, useAppStore, type Screen } from "./store.js";

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  [SCREEN.SETUP]: SetupScreen,
  [SCREEN.SCAN]: ScanScreen,
  [SCREEN.REVIEW]: ReviewScreen,
  [SCREEN.APPLY]: ApplyScreen,
  [SCREEN.HISTORY]: HistoryScreen,
  [SCREEN.LIBRARY]: LibraryScreen,
};

export function App() {
  const screen = useAppStore((state) => state.screen);
  const libraryRoot = useAppStore((state) => state.libraryRoot);
  const goTo = useAppStore((state) => state.goTo);

  const Current = SCREENS[screen];

  const historyLink =
    libraryRoot === undefined || screen === SCREEN.HISTORY ? null : (
      <button
        type="button"
        onClick={() => {
          goTo(SCREEN.HISTORY);
        }}
        className="text-muted hover:text-text text-xs tracking-wide uppercase"
      >
        History
      </button>
    );

  return (
    <div className="min-h-full">
      <div className="drag-region flex h-10 items-center justify-end px-10">{historyLink}</div>
      <Current />
    </div>
  );
}
