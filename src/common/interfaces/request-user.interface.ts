import { Role } from '../enums/role.enum';

export interface RequestUser {
  id: number;
  role: Role;
}
