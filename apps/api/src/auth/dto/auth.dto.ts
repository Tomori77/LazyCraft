import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

// P3-7 用户名规则：2~20 字符，仅中文、英文、数字、下划线
const USERNAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9_]{2,20}$/;

export class RegisterDto {
  @IsString({ message: '用户名不能为空' })
  @Matches(USERNAME_PATTERN, {
    message: '用户名需 2~20 个字符，仅支持中文、英文、数字、下划线',
  })
  username: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @MinLength(8, { message: '密码长度至少 8 位' })
  password: string;
}

export class LoginDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  password: string;
}
