export type ApiConfig = {
  apiUrl: string;
  token: string;
};

export async function apiRequest<TResponse>(
  config: ApiConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<TResponse> {
  const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Klovr Share API ${method} ${path} failed with ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}
