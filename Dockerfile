FROM node:12

RUN apt update && apt install -y git make cmake g++ gcc python3 libstdc++6

ADD . /srv

WORKDIR /srv

RUN cd fastmine && make

RUN npm install --unsafe-perm --build-from-source
RUN npm run tsc

CMD ["node", "src/miner"]

