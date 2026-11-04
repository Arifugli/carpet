import {z} from 'zod';
export const PASSWORD_MIN_LENGTH=6;
export const loginName=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/,'Логин: 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний');
