import { TelemetryProvider } from "./transport/useTelemetry";
import { Dashboard } from "./components/Dashboard";

export default function App() {
  return (
    <TelemetryProvider>
      <Dashboard />
    </TelemetryProvider>
  );
}
