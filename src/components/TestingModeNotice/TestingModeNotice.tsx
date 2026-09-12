// Components/TestingModeNotice/TestingModeNotice.tsx
// Slim sticky strip shown on the navbar: reminds everyone the store is still in
// testing and points to the Suggestions page.
import { Link } from 'react-router-dom';

const TestingModeNotice = () => {
  return (
    <div className="bg-amber-100 dark:bg-amber-900/60 border-b border-amber-200 dark:border-amber-800">
      <div className="container mx-auto px-4 py-1.5 flex items-center justify-center gap-2 text-center text-xs sm:text-sm font-medium text-amber-900 dark:text-amber-300">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="whitespace-nowrap overflow-hidden text-ellipsis">
          Testing mode — data is wiped when we ship for real
        </span>
        <Link
          to="/suggestions"
          className="underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-200 whitespace-nowrap"
        >
          Give feedback
        </Link>
      </div>
    </div>
  );
};

export default TestingModeNotice;