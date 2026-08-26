import { AiSharingManager } from "../../components/ai-sharing-manager";
import { ConfigManager } from "../../components/config-manager";

export default function ConnectionsPage() {
  return (
    <>
      <ConfigManager />
      <AiSharingManager />
    </>
  );
}
