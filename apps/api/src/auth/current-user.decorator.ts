import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  // 从 request 中提取 JwtStrategy.validate() 塞进来的 user 对象
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    return request.user;
  },
);