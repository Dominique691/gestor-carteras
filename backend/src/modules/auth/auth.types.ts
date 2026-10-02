/** DTOs y tipos del módulo de autenticación. */

export interface RegisterRequestDto {
  email: string;
  password: string;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface AuthUserDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthResponseDto {
  token: string;
  user: AuthUserDto;
}

export interface ErrorResponseDto {
  error: string;
  details?: { field: string; message: string }[];
}

/** Contenido del JWT: `sub` es el id del usuario. */
export interface JwtPayload {
  sub: string;
  email: string;
}

export interface ForgotPasswordRequestDto {
  email: string;
}

export interface ResetPasswordRequestDto {
  token: string;
  newPassword: string;
}

export interface MessageResponseDto {
  message: string;
}
