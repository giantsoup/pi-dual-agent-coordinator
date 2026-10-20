// A fixed range keeps every provider broker unreachable from existing tool sandboxes,
// including when another role or a replacement runtime starts a new broker.
export const providerBrokerPorts: readonly number[] = Array.from({ length: 64 }, (_, index) => 49152 + index);
export const protectedLocalPorts: readonly number[] = [1234, 5900, 9222, 9223, ...providerBrokerPorts];

export function projectNetworkProfile(): string {
  return `(allow network-bind network-inbound (local tcp "localhost:*"))
(allow network-outbound (remote tcp "localhost:*"))
(deny network-bind network-inbound ${protectedLocalPorts.map(port => `(local tcp "localhost:${port}")`).join(" ")})
(deny network-outbound ${protectedLocalPorts.map(port => `(remote tcp "localhost:${port}")`).join(" ")})`;
}
