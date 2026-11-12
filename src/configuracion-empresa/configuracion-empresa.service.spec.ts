import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfiguracionEmpresaService } from './configuracion-empresa.service';
import { ConfiguracionEmpresa } from './entities/configuracion-empresa.entity';
import { UpdateConfiguracionDto } from './dto/update-configuracion.dto';

describe('ConfiguracionEmpresaService: anticipo (SPEC 06)', () => {
  let guardada: Partial<ConfiguracionEmpresa>;
  let configRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let suscripciones: { obtenerVigente: jest.Mock };
  let cuentasFlow: { sucursalesSinCuenta: jest.Mock };
  let servicio: ConfiguracionEmpresaService;

  beforeEach(() => {
    guardada = {
      id: 1,
      permitePagoAnticipado: false,
      pagoObligatorio: true,
      tipoAnticipo: undefined,
      montoAnticipo: 0,
    };
    configRepo = {
      findOne: jest.fn(() => Promise.resolve({ ...guardada })),
      save: jest.fn((c: unknown) => Promise.resolve(c)),
      create: jest.fn((c: unknown) => c),
    };
    suscripciones = {
      obtenerVigente: jest.fn().mockResolvedValue({ plan: 'Pro' }),
    };
    cuentasFlow = { sucursalesSinCuenta: jest.fn().mockResolvedValue([]) };
    servicio = new ConfiguracionEmpresaService(
      configRepo as never,
      {} as never,
      {} as never,
      suscripciones as never,
      cuentasFlow as never,
    );
  });

  const actualizar = (dto: UpdateConfiguracionDto) => servicio.update(dto, 10);

  it('activar sin TipoAnticipo responde 400', async () => {
    await expect(
      actualizar({ permitePagoAnticipado: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(configRepo.save).not.toHaveBeenCalled();
  });

  it('Porcentaje con MontoAnticipo = 120 responde 400', async () => {
    await expect(
      actualizar({
        permitePagoAnticipado: true,
        tipoAnticipo: 'Porcentaje',
        montoAnticipo: 120,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Monto exige un entero mayor o igual a 1', async () => {
    for (const montoAnticipo of [0, 1500.5]) {
      await expect(
        actualizar({
          permitePagoAnticipado: true,
          tipoAnticipo: 'Monto',
          montoAnticipo,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('Completo ignora MontoAnticipo', async () => {
    await expect(
      actualizar({ permitePagoAnticipado: true, tipoAnticipo: 'Completo' }),
    ).resolves.toMatchObject({ tipoAnticipo: 'Completo' });
  });

  it('en Gratis, activar responde 403 SUSCRIPCION_LIMITE con recurso pagosOnline', async () => {
    suscripciones.obtenerVigente.mockResolvedValue({ plan: 'Gratis' });

    const error = await actualizar({
      permitePagoAnticipado: true,
      tipoAnticipo: 'Completo',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'SUSCRIPCION_LIMITE',
      recurso: 'pagosOnline',
      plan: 'Gratis',
      limite: 0,
      actual: 0,
    });
  });

  it('una sucursal activa sin cuenta responde 400 y la nombra', async () => {
    cuentasFlow.sucursalesSinCuenta.mockResolvedValue([
      { id: 3, nombre: 'Sucursal Norte' },
    ]);

    const error = await actualizar({
      permitePagoAnticipado: true,
      tipoAnticipo: 'Porcentaje',
      montoAnticipo: 30,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    const cuerpo = (error as BadRequestException).getResponse() as {
      message: string;
      sucursalesSinCuenta: unknown[];
    };
    expect(cuerpo.message).toContain('Sucursal Norte');
    expect(cuerpo.sucursalesSinCuenta).toEqual([
      { id: 3, nombre: 'Sucursal Norte' },
    ]);
  });

  it('una configuración válida se guarda con pagoObligatorio', async () => {
    await expect(
      actualizar({
        permitePagoAnticipado: true,
        pagoObligatorio: false,
        tipoAnticipo: 'Monto',
        montoAnticipo: 5000,
      }),
    ).resolves.toMatchObject({
      permitePagoAnticipado: true,
      pagoObligatorio: false,
      tipoAnticipo: 'Monto',
      montoAnticipo: 5000,
    });
  });

  it('con el anticipo desactivado no se valida plan ni cuentas', async () => {
    suscripciones.obtenerVigente.mockResolvedValue({ plan: 'Gratis' });
    await expect(actualizar({ mostrarPrecios: false })).resolves.toBeDefined();
    expect(suscripciones.obtenerVigente).not.toHaveBeenCalled();
    expect(cuentasFlow.sucursalesSinCuenta).not.toHaveBeenCalled();
  });
});
