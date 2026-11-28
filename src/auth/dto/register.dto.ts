import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const NAME_REGEX = /^[a-zA-ZñÑ\s.-]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
const PHONE_REGEX = /^(\+639\d{9}|09\d{9})$/;

export class RegisterDto {
  @ApiProperty({ example: 'Juan', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(NAME_REGEX, {
    message:
      'firstName may only contain letters, spaces, hyphens, periods, and ñ',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  firstName!: string;

  @ApiProperty({ example: 'Dela Cruz', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(NAME_REGEX, {
    message:
      'lastName may only contain letters, spaces, hyphens, periods, and ñ',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  lastName!: string;

  @ApiProperty({ example: 'juan@example.com', maxLength: 150 })
  @IsEmail()
  @MaxLength(150)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({ example: 'Secret123', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_REGEX, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter, and one digit',
  })
  password!: string;

  @ApiPropertyOptional({ example: '09171234567' })
  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, {
    message: 'phone must be in format 09XXXXXXXXX or +639XXXXXXXXX',
  })
  phone?: string;
}
