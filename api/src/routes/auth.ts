import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { verifyPassword } from '../password';
import { requireAuth, signToken } from '../middleware/auth';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/api/auth/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email or password format' });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };
  const token = signToken(payload);

  res.json({
    token,
    user: payload,
  });
});

authRouter.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});
