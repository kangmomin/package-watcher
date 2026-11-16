import { describe, expect, it } from "vitest";
import { expectInputRejected } from "../test/assertions.ts";
import { classifyFile } from "./index.ts";
import { parseGoSum } from "./go.ts";
import { parsePomXml } from "./maven.ts";

const decl = (deps: { name: string; spec: string; dependencyType: string }[]) =>
  deps.map((dep) => `${dep.name}|${dep.spec}|${dep.dependencyType}`);

describe("go.sum", () => {
  it("[SA-01] go.sum 은 go 의 lock, pom.xml 은 maven 의 선언 파일로 판정한다", () => {
    expect(classifyFile("go.sum")).toEqual({ ecosystem: "go", role: "lock" });
    expect(classifyFile("svc/go.sum")).toEqual({ ecosystem: "go", role: "lock" });
    expect(classifyFile("app/pom.xml")).toEqual({ ecosystem: "maven", role: "manifest" });
  });

  it("[SA-02] go.sum: /go.mod 줄은 건너뛰고 같은 (모듈, 버전)은 1번만, direct 는 채우지 않는다", () => {
    const text =
      "github.com/a/b v1.2.3 h1:abc=\n" +
      "github.com/a/b v1.2.3/go.mod h1:def=\n" +
      "github.com/a/b v1.2.3 h1:abc=\n" +
      "github.com/c/d v0.1.0-rc.1 h1:xyz=\n" +
      "github.com/c/d v0.0.0-20200101000000-abcdef123456/go.mod h1:q=\n";
    const pkgs = parseGoSum(text);
    expect(pkgs).toEqual([
      { name: "github.com/a/b", version: "v1.2.3" },
      { name: "github.com/c/d", version: "v0.1.0-rc.1" },
    ]);
    expect(pkgs.every((pkg) => pkg.direct === undefined)).toBe(true);
  });

  it("[SA-03] go.sum: CRLF 를 읽고, 형식이 틀린 줄은 실패한다", () => {
    expect(parseGoSum("a.com/x v1.0.0 h1:a=\r\n")).toHaveLength(1);
    expectInputRejected(() => parseGoSum("not a go sum line\n"));
    expectInputRejected(() => parseGoSum("a.com/x v1.0.0\n"));
  });
});

const pom = (body: string) => `<?xml version="1.0"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">${body}</project>`;

describe("pom.xml", () => {
  it("[SA-04] pom.xml: dependencies 의 groupId:artifactId 와 version 을 읽고 scope test 도 포함한다", () => {
    const deps = parsePomXml(
      pom(`<dependencies>
        <dependency><groupId>com.a</groupId><artifactId>lib</artifactId><version>1.2.3</version></dependency>
        <dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13</version><scope>test</scope></dependency>
      </dependencies>`),
    );
    expect(decl(deps)).toEqual(["com.a:lib|1.2.3|direct", "junit:junit|4.13|direct"]);
  });

  it("[SA-05] pom.xml: ${prop} 은 properties 와 project.version 으로 풀고 풀 수 없거나 version 이 없으면 빈 spec", () => {
    const deps = parsePomXml(
      pom(`<version>9.9</version><properties><lib.v>2.0.1</lib.v></properties><dependencies>
        <dependency><groupId>g</groupId><artifactId>a</artifactId><version>\${lib.v}</version></dependency>
        <dependency><groupId>g</groupId><artifactId>b</artifactId><version>\${project.version}</version></dependency>
        <dependency><groupId>g</groupId><artifactId>c</artifactId><version>\${unknown}</version></dependency>
        <dependency><groupId>g</groupId><artifactId>d</artifactId></dependency>
      </dependencies>`),
    );
    expect(decl(deps)).toEqual(["g:a|2.0.1|direct", "g:b|9.9|direct", "g:c||direct", "g:d||direct"]);
  });

  it("[SA-06] pom.xml: dependencyManagement 와 build/plugins 의 의존성은 읽지 않고 의존성이 하나뿐이어도 읽는다", () => {
    const deps = parsePomXml(
      pom(`<dependencyManagement><dependencies>
          <dependency><groupId>m</groupId><artifactId>managed</artifactId><version>1</version></dependency>
        </dependencies></dependencyManagement>
        <build><plugins><plugin><groupId>p</groupId><artifactId>plug</artifactId><version>1</version>
          <dependencies><dependency><groupId>p</groupId><artifactId>inner</artifactId><version>1</version></dependency></dependencies>
        </plugin></plugins></build>
        <dependencies><dependency><groupId>g</groupId><artifactId>only</artifactId><version>3</version></dependency></dependencies>`),
    );
    expect(decl(deps)).toEqual(["g:only|3|direct"]);
  });

  it("[SA-07] pom.xml: project 루트가 없거나 깨진 XML 이면 실패한다", () => {
    expectInputRejected(() => parsePomXml("<other/>"));
    expectInputRejected(() => parsePomXml("<project><dependencies>"));
    expect(parsePomXml(pom(""))).toEqual([]);
  });
});
