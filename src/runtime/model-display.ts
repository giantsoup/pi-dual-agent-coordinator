import type { Model } from "@mariozechner/pi-ai";

export interface ModelDisplayInfo {
  name?: string | undefined;
  provider?: string | undefined;
  id?: string | undefined;
  canonical?: string | undefined;
  display: string;
}

export function getModelDisplayInfo(model?: Model<any> | undefined): ModelDisplayInfo {
  if (!model) {
    return { display: "(pi-default)" };
  }

  const canonical = `${model.provider}/${model.id}`;
  return {
    name: model.name,
    provider: model.provider,
    id: model.id,
    canonical,
    display: model.name ? `${model.name} (${canonical})` : canonical
  };
}

export function formatModelDisplay(model?: Model<any> | undefined): string {
  return getModelDisplayInfo(model).display;
}
