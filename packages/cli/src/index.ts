export interface CliInfo {
  name: string;
  commands: string[];
}

export function getCliInfo(): CliInfo {
  return {
    name: "datajam",
    commands: ["init", "sync", "dashboard", "doctor"]
  };
}
