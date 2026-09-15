import { AuthGuard } from '@nestjs/passport';

// 保护需要身份验证的路由：继承自动物 Passport 的 JWT 策略（由 JwtStrategy 注册），把 req.user 交给 strategy 的 validate() 填充
// 关键：不要 @Injectable() 或依赖注入——AuthGuard('jwt') 工厂类已接管实例化，这里只是一个类型别名
export class JwtAuthGuard extends AuthGuard('jwt') {}