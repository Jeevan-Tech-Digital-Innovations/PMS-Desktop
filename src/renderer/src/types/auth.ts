export interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface User {
  userId: number | string;
  username: string;
  name?: string;
  email?: string;
  empNo: string;
  roles: string[];
}

export interface LoginResponse {
  status: string;
  message: string;
  data: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
    refreshExpiresIn: number;
    user: User;
  };
  timestamp: string;
}

export interface ApiResponse<T> {
  status: string;
  message: string;
  data: T;
  timestamp: string;
}

export interface ApiError {
  status: string;
  message: string;
  timestamp: string;
}
