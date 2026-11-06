export interface JwtPayload {
  sub: number;
  email: string;
  rolId: number;
  empresaId: number;
  sucursalId?: number;
  /** Los tokens emitidos antes de SPEC 04 no la traen y cuentan como 0. */
  tokenVersion?: number;
}
