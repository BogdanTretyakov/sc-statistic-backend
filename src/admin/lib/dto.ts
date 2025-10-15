import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class FilesDTO {
  @IsOptional()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  remove?: string | string[];

  @IsOptional()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  clear?: string | string[];
}
