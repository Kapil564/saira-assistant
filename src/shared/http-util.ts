export async function isLocalServerReachable(url: string, timeout = 800): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return true;
  } catch {
    return false;
  }
}
