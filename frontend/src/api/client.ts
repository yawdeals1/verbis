const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  if (!response.ok) {
    throw new ApiError(response.status, await response.text())
  }

  return response.json() as Promise<T>
}

export interface HealthStatus {
  status: 'ok'
  timestamp: string
}

export function getHealth() {
  return request<HealthStatus>('/health')
}
