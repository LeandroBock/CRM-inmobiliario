import { HttpService } from '@nestjs/axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { FxSource } from '../domain/property.enums';
import { FxService } from './fx.service';

/** HttpService simulado: responde lo que se le diga y anota las URLs pedidas. */
function fakeHttp(respond: (url: string) => unknown) {
  const urls: string[] = [];
  const http = {
    get: (url: string) => {
      urls.push(url);
      const r = respond(url);
      return r instanceof Error ? throwError(() => r) : of({ data: r });
    },
  } as unknown as HttpService;
  return { http, urls };
}

describe('FxService', () => {
  it('pide la cotización de venta de cada tipo de dólar a DolarApi', async () => {
    const { http, urls } = fakeHttp(() => ({ compra: 1280, venta: 1300 }));
    const fx = new FxService(http);
    expect(await fx.getRate(FxSource.BLUE)).toMatchObject({ rate: 1300 });
    await fx.getRate(FxSource.MEP);
    await fx.getRate(FxSource.CCL);
    expect(urls).toEqual([
      'https://dolarapi.com/v1/dolares/blue',
      'https://dolarapi.com/v1/dolares/bolsa',
      'https://dolarapi.com/v1/dolares/contadoconliqui',
    ]);
  });

  it('guarda la cotización 30 minutos (no consulta en cada propiedad)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-12T12:00:00Z') });
    try {
      const { http, urls } = fakeHttp(() => ({ venta: 1300 }));
      const fx = new FxService(http);
      await fx.getRate(FxSource.BLUE);
      jest.setSystemTime(new Date('2026-10-12T12:29:00Z'));
      await fx.getRate(FxSource.BLUE);
      expect(urls).toHaveLength(1);
      jest.setSystemTime(new Date('2026-10-12T12:31:00Z'));
      await fx.getRate(FxSource.BLUE);
      expect(urls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([[{ venta: 0 }], [{ venta: 'N/A' }], [{}], [new Error('ECONNREFUSED')]])('respuesta inválida o API caída (%p): error claro, nada en caché', async (response) => {
    const { http } = fakeHttp(() => response);
    const fx = new FxService(http);
    await expect(fx.getRate(FxSource.BLUE)).rejects.toThrow(ServiceUnavailableException);
    await expect(fx.getRate(FxSource.BLUE)).rejects.toThrow(/enviá fxRate manualmente/);
  });

  it('la fecha es la de Argentina (a las 23 h del domingo en Argentina ya es lunes en UTC)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-12T02:30:00Z') }); // domingo 11, 23:30 en Argentina
    try {
      const { http } = fakeHttp(() => ({ venta: 1300 }));
      expect((await new FxService(http).getRate(FxSource.BLUE)).date).toBe('2026-10-11');
    } finally {
      jest.useRealTimers();
    }
  });
});
