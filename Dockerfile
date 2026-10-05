FROM python:3.11-alpine

WORKDIR /app

# Copy all application files
COPY . /app

# Ensure files are readable
RUN chmod -R 755 /app

# Dynamic PORT support (default 8088)
ENV PORT=8088
EXPOSE 8088

# Run server
CMD ["python", "server.py"]
