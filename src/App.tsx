import { createBrowserRouter, RouterProvider } from "react-router";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "@/hooks/useTheme";
import { Toaster } from "@/components/ui";
import { AppShell } from "@/components/layout/AppShell";
import { GridBackdrop } from "@/components/layout/GridBackdrop";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";
import Login from "@/pages/Login";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { Agents, ControlRoom, Maintenance, Memory, Results, Scenarios, Settings } from "@/pages/loaders";

// App pages load on demand, so the landing page opens fast and each page only
// downloads its own code (charts, diagrams) when it is first visited.

// Routes: "/" is the public website, "/app/*" is the Control Room app.
const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/login", element: <Login /> },
  {
    // Everything under /app needs a signed-in user (RequireAuth sends everyone else to /login).
    element: <RequireAuth />,
    children: [
      {
        path: "/app",
        element: <AppShell />,
        children: [
          { index: true, element: <ControlRoom.Component /> },
          { path: "agents", element: <Agents.Component /> },
          { path: "scenarios", element: <Scenarios.Component /> },
          { path: "maintenance", element: <Maintenance.Component /> },
          { path: "memory", element: <Memory.Component /> },
          { path: "results", element: <Results.Component /> },
          { path: "settings", element: <Settings.Component /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
], {
  // Matches Vite's `base`, so routes work when the site lives in a sub-folder.
  basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
});

export default function App() {
  return (
    <ThemeProvider>
      {/* reducedMotion="user": Framer Motion respects prefers-reduced-motion */}
      <MotionConfig reducedMotion="user">
        <GridBackdrop />
        <RouterProvider router={router} />
        <Toaster />
      </MotionConfig>
    </ThemeProvider>
  );
}
