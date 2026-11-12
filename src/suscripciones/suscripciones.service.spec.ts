import { SuscripcionesService } from './suscripciones.service';
import { Suscripcion } from './entities/suscripcion.entity';

const DIA = 24 * 60 * 60 * 1000;

describe('SuscripcionesService.extenderPro (SPEC 06)', () => {
  function montar(suscripcion: Partial<Suscripcion> | null) {
    const manager = {
      findOne: jest.fn().mockResolvedValue(suscripcion),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      create: jest.fn((_: unknown, datos: unknown) => datos),
    };
    const service = new SuscripcionesService({} as never, { manager } as never);
    return { service, manager };
  }

  const cercaDe = (fecha: Date | null, esperado: number) =>
    expect(Math.abs(fecha!.getTime() - esperado)).toBeLessThan(5_000);

  it('Pro que vence en 5 días + 30 días deja FechaFin 35 días adelante', async () => {
    const fin = new Date(Date.now() + 5 * DIA);
    const { service, manager } = montar({ plan: 'Pro', fechaFin: fin });

    const { finAnterior, finNuevo } = await service.extenderPro(1, 30);

    expect(finAnterior).toBe(fin);
    expect(finNuevo!.getTime()).toBe(fin.getTime() + 30 * DIA);
    expect(manager.update).toHaveBeenCalledWith(
      Suscripcion,
      { empresaId: 1 },
      { plan: 'Pro', fechaFin: finNuevo },
    );
  });

  it('una Prueba vigente también suma desde su FechaFin', async () => {
    const fin = new Date(Date.now() + 3 * DIA);
    const { service } = montar({ plan: 'Prueba', fechaFin: fin });
    const { finNuevo } = await service.extenderPro(1, 30);
    expect(finNuevo!.getTime()).toBe(fin.getTime() + 30 * DIA);
  });

  it('desde Gratis cuenta desde hoy y deja el plan en Pro', async () => {
    const { service, manager } = montar({ plan: 'Gratis', fechaFin: null });

    const { finNuevo } = await service.extenderPro(1, 30);

    cercaDe(finNuevo, Date.now() + 30 * DIA);
    expect(manager.update).toHaveBeenCalledWith(
      Suscripcion,
      { empresaId: 1 },
      expect.objectContaining({ plan: 'Pro' }),
    );
  });

  it('un Pro vencido (aún sin degradar) cuenta desde hoy', async () => {
    const { service } = montar({
      plan: 'Pro',
      fechaFin: new Date(Date.now() - 2 * DIA),
    });
    const { finNuevo } = await service.extenderPro(1, 30);
    cercaDe(finNuevo, Date.now() + 30 * DIA);
  });

  it('un Pro sin vencimiento no se toca', async () => {
    const { service, manager } = montar({ plan: 'Pro', fechaFin: null });
    await expect(service.extenderPro(1, 30)).resolves.toEqual({
      finAnterior: null,
      finNuevo: null,
    });
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('sin fila de suscripción la crea en Pro', async () => {
    const { service, manager } = montar(null);
    const { finNuevo } = await service.extenderPro(1, 30);
    cercaDe(finNuevo, Date.now() + 30 * DIA);
    expect(manager.create).toHaveBeenCalledWith(
      Suscripcion,
      expect.objectContaining({ empresaId: 1, plan: 'Pro' }),
    );
  });
});
