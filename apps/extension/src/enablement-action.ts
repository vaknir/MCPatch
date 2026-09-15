import type { ChromeActionApi, ReviewedPackSite } from "./enablement-model.js";

export type ActionStatus =
  "denied" | "disabled" | "enabled" | "unavailable" | "unsupported" | "working";

export async function showEnablementAction(
  action: ChromeActionApi,
  tabId: number,
  status: ActionStatus,
  site?: ReviewedPackSite,
): Promise<void> {
  const view = actionView(status, site);
  try {
    await Promise.all([
      action.setBadgeBackgroundColor({ color: view.color, tabId }),
      action.setBadgeText({ tabId, text: view.badge }),
      action.setTitle({ tabId, title: view.title }),
    ]);
  } catch {
    // Action decoration is informative and never grants authority.
  }
}

export function validActionTabId(
  value: number | undefined,
): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
    ? value
    : undefined;
}

function actionView(
  status: ActionStatus,
  site?: ReviewedPackSite,
): { readonly badge: string; readonly color: string; readonly title: string } {
  const name = site?.manifest.name ?? "MCPatch";
  switch (status) {
    case "enabled":
      return { badge: "ON", color: "#137333", title: `Disable ${name}` };
    case "working":
      return { badge: "…", color: "#5f6368", title: `Updating ${name}` };
    case "denied":
      return {
        badge: "!",
        color: "#b3261e",
        title: `${name} permission denied`,
      };
    case "unavailable":
      return { badge: "!", color: "#b3261e", title: `${name} unavailable` };
    case "unsupported":
      return {
        badge: "—",
        color: "#5f6368",
        title: "No compatible MCPatch pack",
      };
    case "disabled":
      return { badge: "", color: "#5f6368", title: `Enable ${name}` };
  }
}
