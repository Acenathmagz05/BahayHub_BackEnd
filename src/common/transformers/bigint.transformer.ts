import { ValueTransformer } from 'typeorm';

export const bigintTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (
    value: string | number | null | undefined,
  ): number | null | undefined => {
    if (value === null || value === undefined) {
      return value;
    }
    return typeof value === 'number' ? value : Number(value);
  },
};
