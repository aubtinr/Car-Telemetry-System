import { TelemetryProvider } from "./transport/useTelemetry";
import { SettingsProvider } from "./lib/settings";
import { Dashboard } from "./components/Dashboard";

export default function App() {
  return (
    <SettingsProvider>
      <TelemetryProvider>
        <Dashboard />
      </TelemetryProvider>
    </SettingsProvider>
  );
}
