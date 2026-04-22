import { Controller, Post, Get, Body, Req, UseGuards, Put, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, GoogleAuthDto } from './dto/auth.dto';
import { JwtAuthGuard, Public } from './guards/jwt-auth.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @Public()
  @ApiOperation({ summary: 'Create account with email + password' })
  async signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto.email, dto.password, dto.name);
  }

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Login with email + password' })
  async login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.email, dto.password, req.ip);
  }

  @Post('google')
  @Public()
  @ApiOperation({ summary: 'Login/signup with Google OAuth (placeholder)' })
  async google(@Body() dto: GoogleAuthDto) {
    return this.auth.googleAuth(dto.idToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@Req() req: any) {
    return this.auth.getUser(req.user.id);
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check investigation usage limits' })
  async usage(@Req() req: any) {
    return this.auth.canInvestigate(req.user.id);
  }

  @Put('plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upgrade subscription plan' })
  async upgradePlan(@Req() req: any, @Body() body: { plan: 'free' | 'pro' | 'enterprise' }) {
    return this.auth.upgradePlan(req.user.id, body.plan);
  }

  @Put('branding')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update white-label branding (logo + company name)' })
  async updateBranding(@Req() req: any, @Body() body: { logoUrl?: string; companyName?: string }) {
    return this.auth.updateBranding(req.user.id, body.logoUrl, body.companyName);
  }

  @Get('audit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get audit trail for current user' })
  async audit(@Req() req: any, @Query('limit') limit?: string) {
    return this.auth.getAuditLog(req.user.id, parseInt(limit || '50', 10));
  }
}
