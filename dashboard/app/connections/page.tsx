import { AiSharingManager } from "../../components/ai-sharing-manager";
import { ConfigManager } from "../../components/config-manager";
import { WebAiRoutingManager } from "../../components/web-ai-routing-manager";

export default function ConnectionsPage() {
  return (
    <>
      <ConfigManager />
      <WebAiRoutingManager />
      <AiSharingManager />
    </>
  );
}
