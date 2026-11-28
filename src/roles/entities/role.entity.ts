import { Column, Entity, Generated, PrimaryColumn } from 'typeorm';
import { bigintTransformer, Role as RoleName } from '../../common';

@Entity({ name: 'roles' })
export class Role {
  @PrimaryColumn({
    type: 'bigint',
    transformer: bigintTransformer,
  })
  @Generated('increment')
  id!: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  name!: RoleName;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;
}
