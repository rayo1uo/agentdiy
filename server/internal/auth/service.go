package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

type Service struct {
	repo            Repository
	jwtSecret       string
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

func NewService(repo Repository, jwtSecret string, accessTokenTTL, refreshTokenTTL time.Duration) Service {
	return Service{
		repo:            repo,
		jwtSecret:       jwtSecret,
		accessTokenTTL:  accessTokenTTL,
		refreshTokenTTL: refreshTokenTTL,
	}
}

// Register 实现用户的注册功能
func (s Service) Register(ctx context.Context, email, password string) (User, TokenPair, error) {
	email = normalizeEmail(email)
	if email == "" {
		return User{}, TokenPair{}, errors.New("email is required")
	}

	// 处理密码，生成密码字符串的hash值，并存储到数据库中
	hash, err := HashPassword(password)
	if err != nil {
		return User{}, TokenPair{}, err
	}

	user, err := s.repo.CreateUser(ctx, email, hash)
	if err != nil {
		return User{}, TokenPair{}, err
	}

	// 生成JWT Token和Refresh Token
	pair, err := s.issueTokenPair(ctx, user)
	if err != nil {
		return User{}, TokenPair{}, err
	}

	return user, pair, nil
}

// Login 处理用户登陆的后端逻辑：首先验证密码是否正确，密码正确后签发token对
func (s Service) Login(ctx context.Context, email, password string) (User, TokenPair, error) {
	email = normalizeEmail(email)
	if email == "" || strings.TrimSpace(password) == "" {
		return User{}, TokenPair{}, ErrInvalidCredentials
	}

	user, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return User{}, TokenPair{}, ErrInvalidCredentials
		}
		return User{}, TokenPair{}, err
	}

	if !VerifyPassword(password, user.PasswordHash) {
		return User{}, TokenPair{}, ErrInvalidCredentials
	}

	pair, err := s.issueTokenPair(ctx, user)
	if err != nil {
		return User{}, TokenPair{}, err
	}

	return user, pair, nil
}

// Refresh 处理用户刷新Token的后端逻辑：首先验证Refresh Token是否有效，有效后签发新的Token对
func (s Service) Refresh(ctx context.Context, refreshToken string) (User, TokenPair, error) {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return User{}, TokenPair{}, ErrInvalidCredentials
	}

	storedToken, err := s.repo.GetRefreshToken(ctx, refreshToken)
	if err != nil {
		if errors.Is(err, ErrTokenNotFound) {
			return User{}, TokenPair{}, ErrInvalidCredentials
		}
		return User{}, TokenPair{}, err
	}

	if storedToken.RevokedAt != nil || storedToken.ExpiresAt.Before(time.Now().UTC()) {
		return User{}, TokenPair{}, ErrInvalidCredentials
	}

	user, err := s.repo.GetUserByID(ctx, storedToken.UserID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return User{}, TokenPair{}, ErrInvalidCredentials
		}
		return User{}, TokenPair{}, err
	}

	if err := s.repo.RevokeRefreshToken(ctx, refreshToken); err != nil {
		return User{}, TokenPair{}, fmt.Errorf("revoke old refresh token: %w", err)
	}

	pair, err := s.issueTokenPair(ctx, user)
	if err != nil {
		return User{}, TokenPair{}, err
	}

	return user, pair, nil
}

func (s Service) Logout(ctx context.Context, refreshToken string) error {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return nil
	}
	if err := s.repo.RevokeRefreshToken(ctx, refreshToken); err != nil {
		if errors.Is(err, ErrTokenNotFound) {
			return nil
		}
		return err
	}
	return nil
}

func (s Service) issueTokenPair(ctx context.Context, user User) (TokenPair, error) {
	// 签发JWT Access Token
	accessToken, accessExpiresIn, err := GenerateAccessToken(s.jwtSecret, user.ID, user.Email, s.accessTokenTTL)
	if err != nil {
		return TokenPair{}, err
	}

	refreshToken, err := GenerateRefreshToken()
	if err != nil {
		return TokenPair{}, err
	}

	now := time.Now().UTC()
	refreshTokenModel := RefreshToken{
		Token:     refreshToken,
		UserID:    user.ID,
		ExpiresAt: now.Add(s.refreshTokenTTL),
		CreatedAt: now,
	}
	if err := s.repo.StoreRefreshToken(ctx, refreshTokenModel); err != nil {
		return TokenPair{}, err
	}

	return TokenPair{
		AccessToken:           accessToken,
		AccessTokenExpiresIn:  accessExpiresIn,
		RefreshToken:          refreshToken,
		RefreshTokenExpiresIn: int64(s.refreshTokenTTL.Seconds()),
	}, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
