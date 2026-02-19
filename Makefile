.PHONY: build release test clean publish-local

# Dev build
build:
	cd agt && cargo build

# Release build (current platform)
release:
	cd agt && cargo build --release

# Run tests
test:
	cd agt && cargo test

# Clean build artifacts
clean:
	cd agt && cargo clean

# Build for current platform and copy to npm
publish-local: release
	@mkdir -p npm/bin
	cp agt/target/release/agt npm/bin/agt
	chmod +x npm/bin/agt
	@echo "Binary copied to npm/bin/agt"
	@echo "Run: cd npm && npm pack"

# Cross-compile all platforms (requires cross or appropriate targets)
cross-all:
	cd agt && cargo build --release --target aarch64-apple-darwin
	cd agt && cargo build --release --target x86_64-apple-darwin
	cd agt && cross build --release --target x86_64-unknown-linux-musl
	cd agt && cross build --release --target aarch64-unknown-linux-musl

# Copy cross-compiled binaries to npm platform packages
dist: cross-all
	cp agt/target/aarch64-apple-darwin/release/agt npm/platforms/darwin-arm64/bin/agt
	cp agt/target/x86_64-apple-darwin/release/agt npm/platforms/darwin-x64/bin/agt
	cp agt/target/x86_64-unknown-linux-musl/release/agt npm/platforms/linux-x64/bin/agt
	cp agt/target/aarch64-unknown-linux-musl/release/agt npm/platforms/linux-arm64/bin/agt
	@echo "Binaries distributed to npm/platforms/*"
