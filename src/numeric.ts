import { z } from 'zod';
export const decimal = z.string().max(80).regex(/^\d+(?:\.\d+)?$/, '必须是非负十进制字符串');
