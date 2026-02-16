FROM fry-claude:latest

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Copy project source
WORKDIR /opt/fryler
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .

# Mark as container environment
ENV FRYLER_CONTAINER=1

# Data volume (mounted from host ~/.fryler/data/)
VOLUME /root/.fryler

# Wrapper script so `container exec ... fryler <cmd>` works
RUN printf '#!/bin/bash\nexec bun run /opt/fryler/bin/fryler.ts "$@"\n' > /usr/local/bin/fryler \
    && chmod +x /usr/local/bin/fryler

# Default: start the daemon
CMD ["fryler", "start"]
