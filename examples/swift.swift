// List all inventory, following pagination. Swift 5.5+ with URLSession.
// Usage: RELIQRA_API_KEY=<your key> swift swift.swift
import Foundation

struct Page: Decodable {
    struct Item: Decodable {
        let reliqra_id: String
        let status: String?
        let title: String?
    }
    let data: [Item]
    let next_cursor: String?
}

struct ErrorBody: Decodable {
    struct Detail: Decodable { let code: String; let message: String }
    let error: Detail
}

guard let key = ProcessInfo.processInfo.environment["RELIQRA_API_KEY"] else {
    FileHandle.standardError.write(Data("Set RELIQRA_API_KEY to your API key\n".utf8))
    exit(1)
}

func fetchPage(cursor: String?) async throws -> Page {
    var components = URLComponents(string: "https://api.reliqra.com/v1/inventory")!
    components.queryItems = [URLQueryItem(name: "limit", value: "100")]
    if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }

    var request = URLRequest(url: components.url!)
    request.setValue(key, forHTTPHeaderField: "X-Reliqra-Api-Key")

    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
        let detail = try? JSONDecoder().decode(ErrorBody.self, from: data).error
        throw NSError(domain: "ReliqraAPI", code: status, userInfo: [
            NSLocalizedDescriptionKey: "\(status) \(detail?.code ?? "error"): \(detail?.message ?? "")"
        ])
    }
    return try JSONDecoder().decode(Page.self, from: data)
}

var cursor: String? = nil
repeat {
    let page = try await fetchPage(cursor: cursor)
    for item in page.data {
        print(item.reliqra_id, item.status ?? "", item.title ?? "")
    }
    cursor = page.next_cursor
} while cursor != nil
