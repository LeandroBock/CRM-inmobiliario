import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { Lead } from '../src/modules/leads/domain/lead.entity';
import { createLead, createTestApp, createUser, http, resetDb, TestUser } from './helpers';

describe('Puntaje y matching de leads', () => {
  let app: NestExpressApplication;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
    user = await createUser(app);
  });
  afterAll(() => app?.close());

  const property = async (data: Record<string, unknown>) =>
    (
      await http(app)
        .post('/properties')
        .set(user.auth)
        .send({
          title: 'Propiedad',
          type: 'departamento',
          operation: 'venta',
          address: 'X 1',
          neighborhood: 'Centro',
          city: 'Rosario',
          province: 'Santa Fe',
          coveredM2: 50,
          totalM2: 50,
          rooms: 2,
          priceUsd: 100000,
          fxRate: 1300,
          ...data,
        })
        .expect(201)
    ).body as { id: string };

  const match = async (leadId: string) => (await http(app).post(`/lead-engine/leads/${leadId}/match`).set(user.auth).expect(201)).body;
  const titles = (matches: { property: { title: string } }[]) => matches.map((m) => m.property.title);

  describe('matching', () => {
    const buyer = { budgetMaxUsd: 120000, preferredNeighborhoods: ['Centro'], wantedTypes: ['departamento'], minRooms: 2, wantsOperation: 'venta' };

    it('ordena por afinidad y descarta lo que no sirve', async () => {
      await property({ title: 'Ideal' });
      await property({ title: 'Otro barrio', neighborhood: 'Fisherton' });
      await property({ title: 'Un poco caro', priceUsd: 135000 }); // 12,5% arriba: puntaje parcial
      await property({ title: 'Muy caro', priceUsd: 200000, neighborhood: 'Fisherton', type: 'casa', rooms: 5, operation: 'alquiler' });
      await property({ title: 'Vendida', status: 'vendida' });
      const lead = await createLead(app, user, buyer);

      const matches = await match(lead.id);
      expect(titles(matches)).toEqual(['Ideal', 'Un poco caro', 'Otro barrio']);
      expect(matches[0]).toMatchObject({ score: 100, breakdown: { budget: 1, zone: 1, type: 1, rooms: 1, garage: 1, operation: 1 } });
      expect(matches[1].breakdown.budget).toBe(0.5);
    });

    it('el barrio se compara sin distinguir mayúsculas', async () => {
      await property({ title: 'Centro', neighborhood: 'Centro' });
      const lead = await createLead(app, user, { ...buyer, preferredNeighborhoods: ['centro'] });
      expect((await match(lead.id))[0].breakdown.zone).toBe(1);
    });

    it('se queda con el top 5', async () => {
      for (let i = 0; i < 7; i++) await property({ title: `Depto ${i}`, priceUsd: 90000 + i * 1000 });
      const lead = await createLead(app, user, buyer);
      expect(await match(lead.id)).toHaveLength(5);
    });

    it('al recalcular conserva el feedback del cliente y saca lo que ya no está disponible', async () => {
      const liked = await property({ title: 'Le gustó' });
      const sold = await property({ title: 'Se vendió' });
      const lead = await createLead(app, user, buyer);
      const first = await match(lead.id);

      const likedMatch = first.find((m: { property: { id: string } }) => m.property.id === liked.id);
      await http(app).patch(`/lead-engine/matches/${likedMatch.id}/feedback`).set(user.auth).send({ feedback: 'me_gusta' }).expect(200);
      await http(app).patch(`/properties/${sold.id}`).set(user.auth).send({ status: 'vendida' }).expect(200);

      const second = await match(lead.id);
      expect(second.map((m: { property: { title: string }; feedback: string }) => [m.property.title, m.feedback])).toEqual([['Le gustó', 'me_gusta']]);
      // Sin recalcular, la lista guardada es la misma
      expect((await http(app).get(`/lead-engine/leads/${lead.id}/matches`).set(user.auth).expect(200)).body).toHaveLength(1);
    });

    it('feedback inválido o de un match que no existe', async () => {
      await http(app).patch('/lead-engine/matches/00000000-0000-4000-8000-000000000000/feedback').set(user.auth).send({ feedback: 'me_gusta' }).expect(404);
      await http(app).patch('/lead-engine/matches/00000000-0000-4000-8000-000000000000/feedback').set(user.auth).send({ feedback: 'super' }).expect(400);
    });
  });

  describe('puntaje y temperatura', () => {
    it('un lead recién cargado, sin datos de búsqueda, queda frío', async () => {
      const lead = await createLead(app, user);
      expect(lead).toMatchObject({ temperature: 'frio' });
    });

    it('perfil completo, urgente y activo: caliente, y avisa una sola vez', async () => {
      const lead = await createLead(app, user, {
        budgetMaxUsd: 120000,
        wantsOperation: 'venta',
        preferredNeighborhoods: ['Centro'],
        minRooms: 2,
        hasMortgageApproval: true,
      });
      await app.get(DataSource).getRepository(Lead).update(lead.id, { urgency: 1, lastInteractionAt: new Date() });

      const scored = (await http(app).post(`/lead-engine/leads/${lead.id}/score`).set(user.auth).expect(201)).body;
      expect(scored).toMatchObject({ leadScore: 100, temperature: 'caliente' });
      await http(app).post(`/lead-engine/leads/${lead.id}/score`).set(user.auth).expect(201);

      const notes = (await http(app).get('/notifications').set(user.auth).expect(200)).body.filter((n: { type: string }) => n.type === 'lead_caliente');
      expect(notes).toHaveLength(1);
      expect(notes[0].body).toBe('Puntaje 100/100. Buen momento para contactarlo.');
    });

    it('sin actividad hace dos semanas se enfría', async () => {
      const lead = await createLead(app, user, { budgetMaxUsd: 120000, wantsOperation: 'venta', preferredNeighborhoods: ['Centro'], minRooms: 2 });
      await app.get(DataSource).getRepository(Lead).update(lead.id, { urgency: 0.5, lastInteractionAt: new Date(Date.now() - 15 * 86400_000) });
      const scored = (await http(app).post(`/lead-engine/leads/${lead.id}/score`).set(user.auth).expect(201)).body;
      expect(scored.leadScore).toBe(53); // 40 completitud + 12,5 urgencia + 0 actividad
      expect(scored.temperature).toBe('tibio');
    });
  });
});
