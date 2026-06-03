export interface ProxyInfo {
  host: string
  port: number
  username: string
  password: string
}

export interface ProxyProvider {
  getProxy(key: string): Promise<ProxyInfo>
}

export interface PublicProxyInfo {
  host: string
  port: number
}
